// @env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { updateFeedArgs } from "./package-update-feed.mjs";

const require = createRequire(import.meta.url);
const args = [
  require.resolve("electron-builder/cli.js"),
  "--win",
  "nsis",
  "--publish",
  "never",
  "-c.electronDist=node_modules/electron/dist",
];
const feed = updateFeedArgs(process.env.PILOT_UPDATE_URL ?? process.env.PI_UPDATE_URL);
if (feed.length) args.push(...feed, "-c.directories.output=dist/release");
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
