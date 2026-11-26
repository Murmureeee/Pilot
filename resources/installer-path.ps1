param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Add', 'Remove')]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [ValidateSet('CurrentUser', 'LocalMachine')]
    [string]$Scope,
    [Parameter(Mandatory = $true)]
    [string]$InstallDirectory,
    [Parameter(Mandatory = $true)]
    [string]$InstallKey
)

$ErrorActionPreference = 'Stop'
$registryView = if ([Environment]::Is64BitOperatingSystem) { 'Registry64' } else { 'Default' }
$root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Scope, $registryView)
$appKey = $null
$environmentKey = $null

function Normalize-PathEntry([string]$Entry) {
    [Environment]::ExpandEnvironmentVariables($Entry.Trim().Trim('"')).Replace('/', '\').TrimEnd('\')
}

try {
    $directory = [IO.Path]::GetFullPath($InstallDirectory)
    if ($directory.Length -gt ([IO.Path]::GetPathRoot($directory)).Length) {
        $directory = $directory.TrimEnd('\')
    }
    $appKey = $root.OpenSubKey($InstallKey, $true)
    if (!$appKey) { throw 'The Pilot install registry key is missing.' }
    $environmentPath = if ($Scope -eq 'CurrentUser') { 'Environment' } else {
        'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
    }
    $environmentKey = if ($Action -eq 'Add') { $root.CreateSubKey($environmentPath) } else {
        $root.OpenSubKey($environmentPath, $true)
    }
    if (!$environmentKey) { return }

    $rawPath = $environmentKey.GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
    $valueKind = if ($null -eq $rawPath) { 'ExpandString' } else { $environmentKey.GetValueKind('Path') }
    if ($valueKind -notin ('ExpandString', 'String')) { throw 'The existing Path value is not text.' }
    $entries = @(if ($null -ne $rawPath) { $rawPath.Split(';') })

    if ($Action -eq 'Add') {
        $normalizedDirectory = Normalize-PathEntry $directory
        foreach ($entry in $entries) {
            if ([string]::Equals((Normalize-PathEntry $entry), $normalizedDirectory, 'OrdinalIgnoreCase')) {
                return
            }
        }
        if ($directory.Contains(';') -or ($valueKind -eq 'ExpandString' -and
                [Environment]::ExpandEnvironmentVariables($directory) -ne $directory)) {
            throw 'The install directory cannot be represented as a Path entry.'
        }
        $nextPath = if ($rawPath) { $rawPath + ';' + $directory } else { $directory }
        if ($nextPath.Length -ge 32767) { throw 'There is no room to add Pilot to Path.' }

        $appKey.SetValue('PilotAddedPath', $directory, 'String')
        $appKey.SetValue('PilotCreatedPath', [int]($null -eq $rawPath), 'DWord')
        $environmentKey.SetValue('Path', $nextPath, $valueKind)
        return
    }

    # Only remove the literal entry this installer added.
    $addedPath = $appKey.GetValue('PilotAddedPath')
    if (![string]::Equals($addedPath, $directory, 'OrdinalIgnoreCase')) { return }
    for ($index = $entries.Count - 1; $index -ge 0; $index--) {
        if ($entries[$index] -cne $addedPath) { continue }
        $retained = for ($position = 0; $position -lt $entries.Count; $position++) {
            if ($position -ne $index) { $entries[$position] }
        }
        if (!$retained -and $appKey.GetValue('PilotCreatedPath') -eq 1) {
            $environmentKey.DeleteValue('Path', $false)
        } else {
            $environmentKey.SetValue('Path', ($retained -join ';'), $valueKind)
        }
        return
    }
} finally {
    if ($environmentKey) { $environmentKey.Dispose() }
    if ($appKey) { $appKey.Dispose() }
    $root.Dispose()
}
