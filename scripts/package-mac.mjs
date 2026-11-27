// @env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { updateFeedArgs } from "./package-update-feed.mjs";

if (process.platform !== "darwin") throw new Error("Build macOS packages on a Mac.");

const signed = process.env.PILOT_MAC_SIGNED === "true";
if (
  signed &&
  (!process.env.CSC_LINK ||
    !process.env.CSC_KEY_PASSWORD ||
    !process.env.APPLE_API_KEY ||
    !process.env.APPLE_API_KEY_ID ||
    !process.env.APPLE_API_ISSUER)
) {
  throw new Error("The signed release requires a Developer ID certificate and Apple notarization credentials.");
}

const require = createRequire(import.meta.url);
const signing = signed
  ? ["-c.forceCodeSigning=true"]
  : ["-c.mac.identity=-", "-c.mac.hardenedRuntime=false", "-c.mac.notarize=false"];
const result = spawnSync(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    "--mac",
    "--publish",
    "never",
    "-c.electronDist=node_modules/electron/dist",
    ...updateFeedArgs(process.env.PILOT_UPDATE_URL),
    ...signing,
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
