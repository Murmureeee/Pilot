// @env node
import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";

import { GIT_PUBLISH_TIMEOUT_MS, GIT_STATUS_MAX_BYTES } from "./constants";

const run = promisify(execFile);

export async function runGitHubCli(root: string, args: string[], summary: string): Promise<string> {
  try {
    const { stdout } = await run("gh", args, {
      cwd: root,
      windowsHide: true,
      timeout: GIT_PUBLISH_TIMEOUT_MS,
      maxBuffer: GIT_STATUS_MAX_BYTES,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return stdout.trim();
  } catch (error) {
    const failure = error as ExecFileException & { stderr?: string };
    if (failure.code === "ENOENT")
      throw new Error("找不到 GitHub CLI。请安装 gh 后重试。", { cause: error });
    const detail = failure.stderr?.trim().slice(0, 1200);
    throw new Error(detail ? summary + "\n" + detail : summary, { cause: error });
  }
}
