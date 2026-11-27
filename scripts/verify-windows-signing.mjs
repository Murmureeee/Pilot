// @env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const updaterRequire = createRequire(require.resolve("electron-updater"));
const { load } = updaterRequire("js-yaml");
const { parseDn } = updaterRequire("builder-util-runtime");

export function readWindowsPublishers(directory) {
  const config = load(readFileSync(join(directory, "resources", "app-update.yml"), "utf8"));
  const value = config?.publisherName;
  if (value == null) return [];
  const publishers = Array.isArray(value) ? value : [value];
  assert.ok(
    publishers.length > 0 && publishers.every((name) => typeof name === "string" && name.trim()),
    "Invalid publisherName in app-update.yml",
  );
  return publishers;
}

export function verifyWindowsSignatures(files, publishers) {
  assert.equal(process.platform, "win32");
  assert.ok(publishers.length > 0, "The signed build must pin a publisher in app-update.yml");
  const powershell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const command = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $signatures = @(foreach ($file in ($env:PILOT_SIGNATURE_FILES | ConvertFrom-Json)) {
      $entry = Get-AuthenticodeSignature -LiteralPath $file
      [pscustomobject]@{
        status = [string]$entry.Status
        type = [string]$entry.SignatureType
        subject = $entry.SignerCertificate.Subject
        thumbprint = $entry.SignerCertificate.Thumbprint
      }
    })
    ConvertTo-Json -InputObject $signatures -Compress
  `;
  const env = {
    ...process.env,
    PILOT_SIGNATURE_FILES: JSON.stringify(files.map((file) => resolve(file))),
  };
  // Windows PowerShell cannot load modules from PowerShell 7's search path.
  delete env.PSModulePath;
  const check = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
    env,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if (check.error) throw check.error;
  assert.equal(check.status, 0, check.stderr);
  const signatures = JSON.parse(check.stdout);
  assert.equal(signatures.length, files.length);
  for (const [index, signature] of signatures.entries()) {
    const name = basename(files[index]);
    assert.equal(signature.status, "Valid", `${name} Authenticode status is ${signature.status}`);
    assert.equal(signature.type, "Authenticode", `${name} must carry an embedded signature`);
    assert.ok(signature.thumbprint, `${name} must identify its signing certificate`);
    assert.equal(signature.thumbprint, signatures[0].thumbprint, `${name} has a different signer`);
    const subject = parseDn(signature.subject);
    const matches = publishers.some((publisher) => {
      const expected = parseDn(publisher);
      return expected.size
        ? [...expected].every(([key, value]) => subject.get(key) === value)
        : subject.get("CN") === publisher;
    });
    assert.ok(matches, `${name} signature does not match the expected publisher`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [installer, appDirectory] = process.argv.slice(2);
  assert.ok(installer && appDirectory, "Specify the installer and win-unpacked directory");
  const publishers = readWindowsPublishers(appDirectory);
  const publisher = process.env.PILOT_WINDOWS_PUBLISHER?.trim();
  if (publisher) assert.ok(publishers.includes(publisher), "app-update.yml must use the configured publisher");
  verifyWindowsSignatures([installer, join(appDirectory, "pilot.exe")], publishers);

  const manifest = load(readFileSync(join(dirname(installer), "latest.yml"), "utf8"));
  const artifact = manifest.files?.find(({ url }) => url === basename(installer));
  const data = readFileSync(installer);
  const checksum = createHash("sha512").update(data).digest("base64");
  assert.equal(manifest.path, basename(installer));
  assert.equal(manifest.sha512, checksum);
  assert.equal(artifact?.sha512, checksum);
  assert.equal(artifact?.size, data.length);
  console.log(`Verified Authenticode signatures and the update manifest for ${basename(installer)}.`);
}
