$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$version = $env:PILOT_RELEASE_VERSION
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A stable version is required for the release draft.' }
$tag = "v$version"
$changelog = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot '../CHANGELOG.md')
$section = [regex]::Match($changelog, ('(?ms)^## ' + [regex]::Escape($tag) + '[ \t]*\r?\n(?<notes>.*?)(?=^##[ \t]|\z)'))
$releaseNotes = $section.Groups['notes'].Value.Trim()
if (!$releaseNotes) { throw "Add Chinese release notes under '## $tag' in CHANGELOG.md before preparing the draft." }

$repo = $env:GITHUB_REPOSITORY
$directory = Join-Path $env:RUNNER_TEMP 'pilot-release'
$installer = "pilot-${version}-x64-setup.exe"
$files = @(
  $installer
  "$installer.blockmap"
  'latest.yml'
  'latest-linux.yml'
  "pilot-${version}-linux-x86_64.AppImage"
  "pilot-${version}-linux-amd64.deb"
)
if ($env:PILOT_RELEASE_INCLUDE_MACOS -eq 'true') {
  $macArchive = "pilot-${version}-mac-arm64.zip"
  $files += @("pilot-${version}-mac-arm64.dmg", $macArchive, "$macArchive.blockmap", 'latest-mac.yml')
}
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
$linuxManifest = Get-Content -Raw -LiteralPath $expected['latest-linux.yml'].Path
if ($linuxManifest -notmatch ('(?m)^version: ' + [regex]::Escape($version) + '\s*$')) {
  throw 'The Linux update manifest does not match the release version.'
}
foreach ($file in @("pilot-${version}-linux-x86_64.AppImage", "pilot-${version}-linux-amd64.deb")) {
  $sha512 = (Get-FileHash -Algorithm SHA512 -LiteralPath $expected[$file].Path).Hash
  $digest = [Convert]::ToBase64String([Convert]::FromHexString($sha512))
  $entry = '(?m)^\s*- url: ' + [regex]::Escape($file) + '\r?\n[ \t]+sha512: ' + [regex]::Escape($digest) + '\s*$'
  if ($linuxManifest -notmatch $entry) { throw "The Linux update manifest is missing the checksum for $file." }
}
if ($macArchive) {
  $macManifest = Get-Content -Raw -LiteralPath $expected['latest-mac.yml'].Path
  if ($macManifest -notmatch ('(?m)^version: ' + [regex]::Escape($version) + '\s*$')) {
    throw 'The macOS update manifest does not match the release version.'
  }
  foreach ($file in @($macArchive, "pilot-${version}-mac-arm64.dmg")) {
    $sha512 = (Get-FileHash -Algorithm SHA512 -LiteralPath $expected[$file].Path).Hash
    $digest = [Convert]::ToBase64String([Convert]::FromHexString($sha512))
    $entry = '(?m)^\s*- url: ' + [regex]::Escape($file) + '\r?\n[ \t]+sha512: ' + [regex]::Escape($digest) + '\s*$'
    if ($macManifest -notmatch $entry) { throw "The macOS update manifest is missing the checksum for $file." }
  }
}

function Find-PilotRelease {
  $query = '.[] | select(.tag_name == "' + $tag + '") | @json'
  foreach ($line in (gh api --paginate "repos/$repo/releases?per_page=100" --jq $query)) {
    ConvertFrom-Json -InputObject $line
  }
}

$draftCandidates = @(Find-PilotRelease)
if ($draftCandidates.Count -eq 0) {
  $payload = @{
    tag_name = $tag
    target_commitish = $env:GITHUB_SHA
    name = "Pilot $version"
    draft = $true
    body = $releaseNotes
  } | ConvertTo-Json -Compress
  $created = $payload | gh api --method POST "repos/$repo/releases" --input - | ConvertFrom-Json
  $draftCandidates = @($created)
}
if ($draftCandidates.Count -ne 1 -or !$draftCandidates[0].draft -or $draftCandidates[0].target_commitish -ne $env:GITHUB_SHA) {
  throw "Release $tag must be a single draft for this commit."
}
$release = $draftCandidates[0]
$uploadUrl = [uri]($release.upload_url -replace '\{.*$', '')
if ($uploadUrl.Scheme -ne 'https' -or $uploadUrl.Host -ne 'uploads.github.com') { throw 'Unexpected GitHub asset upload URL.' }
$headers = @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json' }
$uploaded = @{}
foreach ($asset in $release.assets) {
  $file = $expected[$asset.name]
  if (!$file -or $asset.size -ne $file.Size -or $asset.digest -ne $file.Digest) {
    throw "The existing draft has a different asset named $($asset.name)."
  }
  $uploaded[$asset.name] = $true
}
foreach ($file in $files) {
  if (!$uploaded.ContainsKey($file)) {
    $name = [uri]::EscapeDataString($file)
    $null = Invoke-RestMethod -Method Post -Uri "$($uploadUrl.AbsoluteUri)?name=$name" -InFile $expected[$file].Path -ContentType 'application/octet-stream' -Headers $headers -TimeoutSec 150
  }
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
