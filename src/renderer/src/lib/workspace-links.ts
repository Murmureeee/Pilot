// @env browser
import { SANITIZED_WORKSPACE_LINK_PREFIX, WORKSPACE_LINK_PREFIX } from "./constants";
import type { WorkspaceLink } from "./types";

export function referenceName(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").split("/").at(-1) || path;
}

function parseWorkspaceLink(url: string): WorkspaceLink | undefined {
  const slashPath = url.replaceAll("\\", "/");
  const fileUrl = /^file:\/\/(?:localhost)?(\/(?!\/).+)$/i.exec(slashPath);
  const target = fileUrl ? fileUrl[1].replace(/^\/(?=[a-z]:\/)/i, "") : slashPath;
  const fileWithLine = /^(.*?)(?:#L(\d+)(?:-L?\d+)?|:(\d+))$/i.exec(target);
  const encodedPath = fileWithLine?.[1] ?? target;
  if (/[?#]/.test(encodedPath)) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return undefined;
  }
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || path.startsWith("//")) return undefined;
  const drivePath = /^[a-z]:\//i.test(path);
  if (!drivePath && /^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
  const fileName = referenceName(path);
  if (!fileUrl && !path.includes("/") && !/\.[\w-]+$/.test(fileName)) return undefined;

  const line = fileWithLine && Number(fileWithLine[2] ?? fileWithLine[3]);
  return {
    path,
    kind: path.endsWith("/") ? "directory" : "file",
    ...(line && Number.isSafeInteger(line) ? { line } : {}),
  };
}

export function workspaceLinkFromHref(href: string | undefined): WorkspaceLink | undefined {
  if (!href) return undefined;
  // Streamdown namespaces fragment targets when it sanitizes Markdown.
  const prefix = href.startsWith(SANITIZED_WORKSPACE_LINK_PREFIX)
    ? SANITIZED_WORKSPACE_LINK_PREFIX
    : WORKSPACE_LINK_PREFIX;
  try {
    return parseWorkspaceLink(
      href.startsWith(prefix) ? decodeURIComponent(href.slice(prefix.length)) : href,
    );
  } catch {
    return undefined;
  }
}

export function remarkWorkspaceLinks(): (tree: unknown) => void {
  function visit(node: unknown): void {
    if (typeof node !== "object" || node === null) return;
    if (
      "type" in node &&
      node.type === "link" &&
      "url" in node &&
      typeof node.url === "string" &&
      parseWorkspaceLink(node.url)
    ) {
      // Keep local links through Markdown sanitization as inert fragments.
      node.url = WORKSPACE_LINK_PREFIX + encodeURIComponent(node.url);
    }
    if ("children" in node && Array.isArray(node.children)) node.children.forEach(visit);
  }
  return visit;
}
