// @env node
import {
  existsSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readFileSnapshot,
  recordFileChange,
  restoreFileChange,
} from "../src/main/workspace/file-changes";
import { buildTextDiff } from "../src/main/workspace/text-diff";

describe("text diff", () => {
  it("creates separate hunks with real line numbers and omits distant context", () => {
    const unchanged = Array.from({ length: 14 }, (_, i) => "line " + i).join("\n");
    const result = buildTextDiff(
      "old\n" + unchanged + "\nend\n",
      "new\n" + unchanged + "\nfinish\nextra\n",
    );
    expect(result.stats).toEqual({ added: 3, removed: 2 });
    expect(result.diff.hunks).toHaveLength(2);
    expect(result.diff.hunks[0].slice(0, 2)).toEqual([
      { kind: "removed", before: 1, text: "old" },
      { kind: "added", after: 1, text: "new" },
    ]);
    expect(result.diff.hunks[1].at(-1)).toEqual({ kind: "added", after: 17, text: "extra" });
    expect(result.diff.truncated).toBe(false);
  });

  it("keeps total counts when shortening a large preview", () => {
    const { stats, diff } = buildTextDiff(null, "new line\n".repeat(1000));
    expect(stats).toEqual({ added: 1000, removed: 0 });
    expect(diff.truncated).toBe(true);
    expect(diff.hunks.flat().length).toBeLessThan(stats.added);
  });

  it("marks a removed final newline without changing the displayed line text", () => {
    const { stats, diff } = buildTextDiff("last line\n", "last line");
    expect(stats).toEqual({ added: 1, removed: 1 });
    expect(diff.hunks[0]).toEqual([
      { kind: "removed", before: 1, text: "last line" },
      { kind: "added", after: 1, text: "last line", noNewline: true },
    ]);
  });
});

describe("recorded file changes", () => {
  it("reverts the exact bytes and refuses to overwrite subsequent edits", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-file-change-"));
    const root = realpathSync(fixture.path);
    const path = join(root, "notes.md");
    const original = "\uFEFFhello\r\nsecond\r\n";
    writeFileSync(path, original);
    const before = readFileSnapshot(path);
    const changed = "\uFEFFhello\r\nupdated\r\n";
    writeFileSync(path, changed);
    const { pilotFileChange: change } = recordFileChange(path, root, before, changed);
    expect(change?.summary).toMatchObject({
      path: "notes.md",
      kind: "modified",
      stats: { added: 1, removed: 1 },
    });
    if (!change) throw new Error("Missing change record");
    writeFileSync(path, "local version");
    expect(() => restoreFileChange(change, root)).toThrow("文件已有后续改动");
    expect(readFileSync(path, "utf8")).toBe("local version");
    writeFileSync(path, changed);
    expect(() => restoreFileChange(change, undefined)).toThrow("工作目录已变更");
    restoreFileChange(change, root);
    restoreFileChange(change, root);
    expect(readFileSync(path)).toEqual(Buffer.from(original));
    expect(readdirSync(root)).toEqual(["notes.md"]);
  });

  it("removes a file created by the recorded write and skips no-op and binary previews", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-file-change-"));
    const root = realpathSync(fixture.path);
    const path = join(root, "new.txt");
    const before = readFileSnapshot(path);
    expect(before).toBeNull();
    writeFileSync(path, "new\n");
    const { pilotFileChange: change } = recordFileChange(path, root, before, "new\n");
    expect(change?.summary.kind).toBe("created");
    if (!change) throw new Error("Missing change record");
    expect(recordFileChange(path, root, "new\n", "new\n")).toEqual({});
    expect(
      recordFileChange(path, root, "new\n", "\0").pilotFileChange?.summary.stats,
    ).toBeUndefined();
    restoreFileChange(change, root);
    expect(existsSync(path)).toBe(false);
  });
});
