import { describe, expect, it } from "vitest";
import { projectParents, sessionRowStatus } from "../src/renderer/src/lib/sidebar";
import type { ActiveRun, InterruptedRun } from "../src/shared/contract";

function run(status: ActiveRun["status"], sessionId = "a"): ActiveRun {
  return { runId: "r", sessionId, status, workingDirectory: null };
}

const interrupted: InterruptedRun = { runId: "r", sessionId: "a", workingDirectory: null };

describe("sessionRowStatus", () => {
  it("shows the run state of the session that owns the active run", () => {
    expect(sessionRowStatus({ id: "a" }, run("waiting_approval"), null)).toBe("approval");
    expect(sessionRowStatus({ id: "a" }, run("streaming"), null)).toBe("running");
    expect(sessionRowStatus({ id: "a" }, run("stopping"), null)).toBe("stopping");
  });

  it("puts the run state above interrupted and unread", () => {
    expect(sessionRowStatus({ id: "a", unread: true }, run("streaming"), interrupted)).toBe(
      "running",
    );
    expect(sessionRowStatus({ id: "a", unread: true }, null, interrupted)).toBe("interrupted");
  });

  it("falls back to unread for sessions without a run", () => {
    expect(sessionRowStatus({ id: "b", unread: true }, run("streaming"), interrupted)).toBe(
      "unread",
    );
    expect(sessionRowStatus({ id: "b" }, run("streaming"), interrupted)).toBeNull();
  });
});

describe("projectParents", () => {
  it("adds the parent folder only for projects that share a name", () => {
    const parents = projectParents(["E:\\work\\app", "D:/clients/acme/app/", "E:\\work\\site"]);
    expect([...parents]).toEqual([
      ["E:\\work\\app", "work"],
      ["D:/clients/acme/app/", "acme"],
    ]);
  });

  it("leaves a same-named drive root without a suffix", () => {
    expect(projectParents(["app", "E:/app"]).get("app")).toBeUndefined();
  });
});
