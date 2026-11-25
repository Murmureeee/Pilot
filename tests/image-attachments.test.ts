import {
  mkdtempDisposableSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { droppedWorkspaceReferences } from "../src/main/agent-host/mentions";
import { SessionStore, messageParts } from "../src/main/agent-host/session-store";
import type { ReferencedUserMessage } from "../src/main/agent-host/types";
import type { ImageAttachment } from "../src/shared/contract";

const image: ImageAttachment = {
  type: "image",
  name: "Screenshot.png",
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
};

describe("image attachments", () => {
  it("keeps drafts and stored image messages recoverable with separate text saves", () => {
    using scratch = mkdtempDisposableSync(join(tmpdir(), "pilot-image-store-"));
    const store = new SessionStore(scratch.path);
    const { id } = store.create();
    const { name, ...block } = image;
    const message: ReferencedUserMessage = {
      role: "user",
      content: [block],
      pilotImageNames: [name],
      timestamp: 1,
    };
    store.saveDraftImages(id, [image]);
    store.saveDraft(id, ["original"]);
    store.save(id, [message]);
    const restored = new SessionStore(scratch.path);
    expect(restored.loadDraft(id)).toEqual(["original"]);
    expect(restored.loadDraftImages(id)).toEqual([image]);
    expect(messageParts(restored.load(id)[0])).toContainEqual(image);
    expect(restored.searchTranscripts(name).hits).toHaveLength(1);
    expect(restored.exportMarkdown(id, "en").markdown).toContain("Image attachment · " + name);
    restored.clearDraft(id);
    expect(restored.loadDraftImages(id)).toEqual([]);
    expect(messageParts(restored.load(id)[0])).toContainEqual(image);
    restored.saveDraftImages(id, [image]);
    restored.remove(id);
    expect(restored.loadDraftImages(id)).toEqual([]);
  });

  it("resolves dropped project paths and rejects paths outside the project", () => {
    using scratch = mkdtempDisposableSync(join(tmpdir(), "pilot-drop-"));
    const root = realpathSync(scratch.path);
    const project = join(root, "project");
    const folder = join(project, "notes");
    const outside = join(root, "other");
    mkdirSync(folder, { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(folder, "guide.md"), "# Guide");
    writeFileSync(join(outside, "outside.md"), "# Outside");
    symlinkSync(outside, join(project, "link"), "junction");
    const guide = join(folder, "guide.md");
    const files = droppedWorkspaceReferences(project, [
      guide,
      folder,
      guide,
      project,
      join(project, "link", "outside.md"),
      join(outside, "outside.md"),
    ]);
    expect(files).toEqual([
      {
        type: "file",
        id: "notes/guide.md",
        label: "guide.md",
        meta: { workingDirectory: project },
      },
      { type: "directory", id: "notes", label: "notes", meta: { workingDirectory: project } },
    ]);
  });
});
