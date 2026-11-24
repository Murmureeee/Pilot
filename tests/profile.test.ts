// @env node
import { existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { prepareUserDataDirectory } from "../src/main/profile";

it.each(["pi Desktop", "pi-desktop"])("adopts an existing %s profile as Pilot", (name) => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-profile-"));
  const previous = join(fixture.path, name);
  const current = join(fixture.path, "Pilot");
  mkdirSync(join(previous, "sessions"), { recursive: true });
  writeFileSync(join(previous, "sessions", "history.jsonl"), "saved transcript");
  writeFileSync(join(previous, "Local State"), "original encryption metadata");

  expect(prepareUserDataDirectory(fixture.path)).toBe(current);
  expect(prepareUserDataDirectory(fixture.path)).toBe(current);
  expect(existsSync(previous)).toBe(false);
  expect(readFileSync(join(current, "sessions", "history.jsonl"), "utf8")).toBe("saved transcript");
  expect(readFileSync(join(current, "Local State"), "utf8")).toBe("original encryption metadata");
});

it("reuses a Pilot profile without overwriting it with data from a legacy profile", () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-profile-"));
  const current = join(fixture.path, "Pilot");
  expect(prepareUserDataDirectory(fixture.path)).toBe(current);
  writeFileSync(join(current, "settings.json"), "{}");
  const previous = join(fixture.path, "pi Desktop");
  mkdirSync(previous);
  writeFileSync(join(previous, "settings.json"), '{"persona":"old"}');
  expect(prepareUserDataDirectory(fixture.path)).toBe(current);
  expect(readFileSync(join(current, "settings.json"), "utf8")).toBe("{}");
  expect(existsSync(join(previous, "settings.json"))).toBe(true);
});
