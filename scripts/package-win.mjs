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

const certificate = process.env.WIN_CSC_LINK?.trim() || process.env.CSC_LINK?.trim();
const publisher = process.env.PILOT_WINDOWS_PUBLISHER?.trim();
if (publisher && !certificate) throw new Error("PILOT_WINDOWS_PUBLISHER requires a signing certificate");
if (certificate) args.push("-c.win.forceCodeSigning=true");
if (publisher) args.push(`-c.win.signtoolOptions.publisherName=${publisher}`);

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
