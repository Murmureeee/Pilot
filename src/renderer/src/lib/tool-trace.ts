// @env browser
import type { ToolFailure, ToolStackFrame } from "./types";
import { workspaceLinkFromHref } from "./workspace-links";

export function toolInput(source: string | undefined): { preview: string; details: string } {
  if (!source || source === "{}") return { preview: "", details: "" };
  try {
    const input: unknown = JSON.parse(source);
    if (!input || typeof input !== "object") return { preview: source, details: source };
    const fields = input as Record<string, unknown>;
    const primary = [fields.command, fields.path, fields.pattern].find(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
    return {
      preview: primary ?? source,
      details:
        primary && Object.keys(fields).length === 1 ? primary : JSON.stringify(input, null, 2),
    };
  } catch {
    return { preview: source, details: source };
  }
}

function stackFrame(text: string): ToolStackFrame | undefined {
  const frame = /^at (?:(.*?) \((.+)\)|(.+))$/.exec(text);
  if (!frame) return undefined;
  const location = (frame[2] ?? frame[3]).replace(/^async /, "");
  if (location === "<anonymous>" || location === "native") return { text, framework: true };
  const position = /^(.*?):(\d+)(?::\d+)?$/.exec(location);
  if (!position) return undefined;
  const [, path, line] = position;
  const lineNumber = Number(line);
  const framework = /^(?:node:|internal[\\/])|(?:^|[\\/])node_modules(?:[\\/]|$)/.test(path);
  const url = path.startsWith("file:")
    ? path
    : path.replace(/[%?#]/g, (character) => encodeURIComponent(character));
  const reference =
    !framework && Number.isSafeInteger(lineNumber) && lineNumber > 0
      ? workspaceLinkFromHref(url + "#L" + line)
      : undefined;
  if (!framework && !reference && !/^https?:\/\//i.test(path)) return undefined;
  return {
    text,
    name: frame[1],
    framework,
    reference,
  };
}

export function parseToolFailure(output: string): ToolFailure {
  const lines = output.trim().split(/\r?\n/);
  const first = lines[0];
  // The shell tool prefixes the actual output with its exit status.
  const start = first.startsWith("命令") && lines[1] === "输出:" && lines.length > 2 ? 2 : 0;
  const frames: ToolStackFrame[] = [];
  const message: string[] = [];
  for (const line of lines.slice(start)) {
    const frame = stackFrame(line.trim());
    if (frame) frames.push(frame);
    else message.push(line);
  }
  const errorLine = message.find((line) =>
    /^(?:[\w$.]+(?:Error|Exception)|Error|Exception)(?:\s*\[[^\]]+\])?:/.test(line.trim()),
  );
  return {
    summary: errorLine?.trim() || first,
    message: message.join("\n").trim() || first,
    frames,
  };
}

export function stackDisplayPath(path: string, workspace: string | undefined): string {
  if (!workspace) return path;
  const root = workspace.replaceAll("\\", "/").replace(/\/+$/, "") + "/";
  const inWorkspace = /^[a-z]:\//i.test(root)
    ? path.toLowerCase().startsWith(root.toLowerCase())
    : path.startsWith(root);
  return inWorkspace ? path.slice(root.length) : path;
}
