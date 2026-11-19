// @env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = [
  require.resolve("electron-builder/cli.js"),
  "--win",
  "nsis",
  "--publish",
  "never",
  "-c.electronDist=node_modules/electron/dist",
];
const source = process.env.PI_UPDATE_URL?.trim();
if (source) {
  const url = new URL(source);
  if (url.username || url.password) throw new Error("PI_UPDATE_URL cannot contain credentials");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("PI_UPDATE_URL must use HTTPS or a local HTTP test server");
  }
  args.push("-c.publish.provider=generic", `-c.publish.url=${url.href}`, "-c.directories.output=dist/release");
}
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
