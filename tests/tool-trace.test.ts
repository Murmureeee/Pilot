// @env browser
import { describe, expect, it } from "vitest";

import { parseToolFailure, stackDisplayPath } from "../src/renderer/src/lib/tool-trace";

describe("tool failure trace", () => {
  it("extracts project and framework frames from an actual shell error format", () => {
    const first = "at seedUsers (file:///E:/work/Pilot/prisma/seed%20fixture.cjs:27:6)";
    const second = "at async main (E:\\work\\Pilot\\prisma\\seed #100%.cjs:51:9)";
    const dependency = "at load (E:\\work\\Pilot\\node_modules\\dep\\index.js:20:4)";
    const runtime = "at Module._compile (node:internal/modules/cjs/loader:1688:14)";
    const anonymous = "at Array.map (<anonymous>)";
    const summary = "TypeError: Cannot read properties of undefined (reading 'email')";
    const output = [
      "命令失败（exit 1）",
      "输出:",
      "Seeding fixture",
      summary,
      "    " + first,
      "    " + second,
      "    " + dependency,
      "    " + runtime,
      "    " + anonymous,
      "Node.js v24",
    ].join("\r\n");
    expect(parseToolFailure(output)).toEqual({
      summary,
      message: "Seeding fixture\n" + summary + "\nNode.js v24",
      frames: [
        {
          text: first,
          name: "seedUsers",
          framework: false,
          reference: { kind: "file", path: "E:/work/Pilot/prisma/seed fixture.cjs", line: 27 },
        },
        {
          text: second,
          name: "async main",
          framework: false,
          reference: { kind: "file", path: "E:/work/Pilot/prisma/seed #100%.cjs", line: 51 },
        },
        { text: dependency, name: "load", framework: true, reference: undefined },
        { text: runtime, name: "Module._compile", framework: true, reference: undefined },
        { text: anonymous, framework: true },
      ],
    });
  });

  it("retains ordinary command and permission errors as text", () => {
    expect(
      parseToolFailure("命令失败（exit 1）\n输出:\nUnable to read input\n  at phase:2"),
    ).toEqual({
      summary: "命令失败（exit 1）",
      message: "Unable to read input\n  at phase:2",
      frames: [],
    });
    expect(parseToolFailure("用户拒绝了本次工具调用")).toEqual({
      summary: "用户拒绝了本次工具调用",
      message: "用户拒绝了本次工具调用",
      frames: [],
    });
  });

  it("uses workspace-relative labels for contained Windows and Linux paths", () => {
    expect(stackDisplayPath("e:/work/Pilot/prisma/seed.cjs", "E:\\work\\Pilot")).toBe(
      "prisma/seed.cjs",
    );
    expect(stackDisplayPath("E:/work/Pilot-archive/seed.cjs", "E:\\work\\Pilot")).toBe(
      "E:/work/Pilot-archive/seed.cjs",
    );
    expect(stackDisplayPath("/project/src/run.js", "/project/")).toBe("src/run.js");
    expect(stackDisplayPath("/Project/src/run.js", "/project/")).toBe("/Project/src/run.js");
  });
});
