// @env all
const WSL_SHARE =
  /^(?:\\\\\?\\UNC\\|\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]+([a-z0-9][a-z0-9_.-]*)(?:[\\/](.*))?$/i;

export function wslProjectPath(
  directory: string | undefined | null,
): { distribution: string; path: string } | undefined {
  const match = directory && WSL_SHARE.exec(directory);
  if (!match) return;
  const segments = (match[2] ?? "").split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("\0")))
    return;
  return { distribution: match[1], path: "/" + segments.join("/") };
}

export function wslShellLabel(directory: string | undefined | null): string | undefined {
  const project = wslProjectPath(directory);
  return project && "WSL · " + project.distribution;
}
