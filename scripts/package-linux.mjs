// @env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { updateFeedArgs } from "./package-update-feed.mjs";

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Linux packages must be built on a Linux x64 host.");
}

const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    "--linux",
    "--x64",
    "--publish",
    "never",
    "-c.electronDist=node_modules/electron/dist",
    ...updateFeedArgs(process.env.PILOT_UPDATE_URL),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
