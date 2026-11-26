// @env node
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applicationArguments,
  projectEntryArgument,
  projectEntryFromInstance,
} from "../src/main/project-entry";

describe("project launch arguments", () => {
  const caller = resolve("caller directory");

  it("discards the Electron app path and its leading switches only in development", () => {
    expect(
      applicationArguments(
        [
          "electron",
          "--inspect=0",
          "--remote-debugging-port=0",
          ".",
          "--user-data-dir=profile",
          "Project Folder",
        ],
        true,
      ),
    ).toEqual(["--user-data-dir=profile", "Project Folder"]);
    expect(applicationArguments(["pilot", "Project Folder"], false)).toEqual(["Project Folder"]);
  });

  it("resolves a relative folder against the launching process and preserves spaces", () => {
    const project = resolve(caller, "项目 & notes");
    expect(projectEntryArgument(["--user-data-dir=profile", "项目 & notes"], caller)).toBe(project);
    expect(projectEntryArgument([project], caller)).toBe(project);
    expect(projectEntryArgument(["--open-project", project, "--inspect=0"], caller)).toBe(project);
    expect(projectEntryArgument(["--open-project=项目 & notes"], caller)).toBe(project);
  });

  it("supports explicit dash-leading folder names and separates them from flags", () => {
    expect(projectEntryArgument(["--", "--smoke"], caller)).toBe(resolve(caller, "--smoke"));
    expect(projectEntryArgument(["--open-project", "-notes"], caller)).toBe(
      resolve(caller, "-notes"),
    );
    expect(projectEntryArgument(["--updated", "--inspect=0"], caller)).toBeUndefined();
  });

  it("treats empty or multiple targets as invalid and safely reads the second launch data", () => {
    for (const args of [
      ["--open-project"],
      ["--open-project="],
      ["--"],
      ["a", "b"],
      ["a", "--open-project", "b"],
      ["--", "a", "b"],
      ["nul\0folder"],
    ]) {
      expect(projectEntryArgument(args, caller)).toBeNull();
    }
    expect(projectEntryFromInstance({ project: resolve(caller, "project") })).toBe(
      resolve(caller, "project"),
    );
    expect(projectEntryFromInstance({ project: null })).toBeNull();
    expect(projectEntryFromInstance({ project: "./relative" })).toBeUndefined();
    expect(projectEntryFromInstance({ project: [] })).toBeUndefined();
    expect(projectEntryFromInstance({})).toBeUndefined();
  });
});
