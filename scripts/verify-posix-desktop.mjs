// @env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

export async function waitFor(label, check, timeout = 25_000) {
  const end = performance.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(120);
  } while (performance.now() < end);
  throw new Error("Timed out waiting for " + label);
}

export async function hash(path) {
  const digest = createHash("sha512");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("base64");
}

export async function expectUpdateState(page, expected) {
  return waitFor("update state " + expected, async () => {
    const status = await page.evaluate(() => window.pi.getUpdateStatus());
    if (status.state === "error" && expected !== "error") {
      throw new Error("Unexpected update error: " + JSON.stringify(status));
    }
    return status.state === expected && status;
  });
}

export async function openUpdate(page) {
  await page.getByRole("button", { name: "应用菜单", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "检查更新…", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "软件更新", exact: true });
  await dialog.waitFor();
  return dialog;
}

export async function verifyProjectShell(page, directory) {
  const id = await waitFor("the project selected on launch", async () => {
    const snapshot = await page.evaluate(() => window.pi.getSnapshot());
    return snapshot.draftWorkingDirectory === directory && snapshot.composerId;
  });
  const terminal = await page.evaluate(
    ([id, path]) => window.pi.sessionOpenTerminal(id, path, { columns: 80, rows: 24 }),
    [id, directory],
  );
  assert.equal(terminal.shell, "bash");
  assert.equal(terminal.workingDirectory, directory);
  try {
    // Printing the file separately ensures the marker came from Bash, not the echo of the command.
    await page.evaluate(
      ([id, terminalId]) => window.pi.sessionWriteTerminal(id, terminalId, "cat marker.txt\r"),
      [id, terminal.id],
    );
    await waitFor("Bash to read the project file", async () => {
      const output = await page.evaluate(
        ([id, terminalId]) => window.pi.sessionTerminalOutput(id, terminalId),
        [id, terminal.id],
      );
      return output.data.includes("Pilot project fixture");
    });
  } finally {
    await page.evaluate(
      ([id, terminalId]) => window.pi.sessionStopTerminal(id, terminalId),
      [id, terminal.id],
    );
    await waitFor("the interactive shell to stop", async () => {
      const terminals = await page.evaluate((id) => window.pi.sessionTerminals(id), id);
      return !terminals.some(({ id, status }) => id === terminal.id && status === "running");
    });
  }
}
