$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$version = $env:PILOT_RELEASE_VERSION
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A stable version is required for the release draft.' }
$tag = "v$version"
$repo = $env:GITHUB_REPOSITORY
$directory = Join-Path $env:RUNNER_TEMP 'pilot-release'
$installer = "pi-desktop-${version}-x64-setup.exe"
$files = @($installer, "$installer.blockmap", 'latest.yml')
$expected = @{}
foreach ($file in $files) {
  $item = Get-Item -LiteralPath (Join-Path $directory $file)
  if ($item.Length -le 0) { throw "Empty release asset $file" }
  $expected[$file] = @{
    Path = $item.FullName
    Size = $item.Length
    Digest = 'sha256:' + (Get-FileHash -LiteralPath $item.FullName).Hash.ToLowerInvariant()
  }
}

$manifest = Get-Content -Raw -LiteralPath $expected['latest.yml'].Path
$installerHash = (Get-FileHash -Algorithm SHA512 -LiteralPath $expected[$installer].Path).Hash
$base64 = [Convert]::ToBase64String([Convert]::FromHexString($installerHash))
if ($manifest -notmatch ('(?m)^version: ' + [regex]::Escape($version) + '\s*$') -or
    $manifest -notmatch ('(?m)^path: ' + [regex]::Escape($installer) + '\s*$') -or
    $manifest -notmatch ('(?m)^sha512: ' + [regex]::Escape($base64) + '\s*$')) {
  throw 'The update manifest does not match the version and checksum of the installer.'
}

function Find-PilotRelease {
  $pages = (gh api --paginate --slurp "repos/$repo/releases?per_page=100") | ConvertFrom-Json -NoEnumerate
  foreach ($page in $pages) {
    foreach ($release in $page) {
      if ($release.tag_name -eq $tag) { $release }
    }
  }
}

$draftCandidates = @(Find-PilotRelease)
if ($draftCandidates.Count -eq 0) {
  gh release create $tag --repo $repo --draft --target $env:GITHUB_SHA --title "Pilot $version" --generate-notes
  $draftCandidates = @(Find-PilotRelease)
}
if ($draftCandidates.Count -ne 1 -or !$draftCandidates[0].draft -or $draftCandidates[0].target_commitish -ne $env:GITHUB_SHA) {
  throw "Release $tag must be a single draft for this commit."
}
$release = $draftCandidates[0]
$uploaded = @{}
foreach ($asset in $release.assets) {
  $file = $expected[$asset.name]
  if (!$file -or $asset.size -ne $file.Size -or $asset.digest -ne $file.Digest) {
    throw "The existing draft has a different asset named $($asset.name)."
  }
  $uploaded[$asset.name] = $true
}
foreach ($file in $files) {
  if (!$uploaded.ContainsKey($file)) { gh release upload $tag $expected[$file].Path --repo $repo }
}

$verified = gh api "repos/$repo/releases/$($release.id)" | ConvertFrom-Json
if (!$verified.draft -or $verified.assets.Count -ne $files.Count) { throw 'The draft is missing release assets.' }
foreach ($asset in $verified.assets) {
  $file = $expected[$asset.name]
  if (!$file -or $asset.size -ne $file.Size -or $asset.digest -ne $file.Digest) {
    throw "GitHub did not verify the uploaded asset $($asset.name)."
  }
  Write-Output "Verified GitHub asset $($asset.name) ($($asset.size) bytes)."
}
Write-Output "Verified release draft $tag for $env:GITHUB_SHA."
