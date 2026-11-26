// @env node
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";

import type { PluginFormat, PluginPackagePreview } from "@shared/imports";

import {
  PROMPT_TEMPLATE_LIMIT,
  PROMPT_TEMPLATE_NAME_PATTERN,
  PROMPT_TEMPLATE_TEXT_LIMIT,
} from "../../shared/constants";
import { within } from "./files";
import {
  PACKAGE_ROOT_MARKERS,
  PACKAGE_SCRIPT,
  PACKAGE_UNSUPPORTED_LABELS,
} from "./package-constants";
import { object, readPlugin } from "./sources";
import type { ConfigObject, ImportLocations, PackageManifest } from "./types";

function packageRoot(root: string): string {
  if (PACKAGE_ROOT_MARKERS.some((name) => existsSync(join(root, name)))) return root;
  const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return folders.length === 1 ? join(root, folders[0].name) : root;
}

function json(path: string): ConfigObject {
  if (!existsSync(path)) return {};
  try {
    return object(JSON.parse(readFileSync(path, "utf8").replace(/^\ufeff/, "")));
  } catch (cause) {
    throw new Error("无法解析插件清单。请修正 JSON 后重新预览。", { cause });
  }
}

function formatOf(root: string, manifest: ConfigObject): PluginFormat {
  if (existsSync(join(root, ".claude-plugin", "plugin.json"))) return "claude-code";
  if (["plugin.json", ".codex-plugin/plugin.json"].some((path) => existsSync(join(root, path))))
    return "codex";
  if (
    manifest.pi !== undefined ||
    (Array.isArray(manifest.keywords) && manifest.keywords.includes("pi-package"))
  )
    return "pi";
  return existsSync(join(root, "SKILL.md")) ? "skill" : "pi";
}

function resourceFiles(
  root: string,
  candidates: readonly string[],
  declarations: unknown,
  defaults: readonly string[],
): string[] {
  const globs =
    declarations === undefined
      ? defaults
      : Array.isArray(declarations)
        ? declarations
        : [declarations];
  const found = new Set<string>();
  for (const entry of globs) {
    if (typeof entry !== "string" || !entry) continue;
    const exclude = entry.startsWith("!");
    const expression = (exclude ? entry.slice(1) : entry).replaceAll("\\", "/");
    if (!expression || isAbsolute(expression) || expression.split("/").includes("..")) continue;
    const paths = globSync(expression, { cwd: root })
      .map((path) => join(root, path))
      .filter((path) => within(root, path));
    for (const path of candidates) {
      if (!paths.some((match) => within(match, path))) continue;
      if (exclude) found.delete(path);
      else found.add(path);
    }
  }
  return [...found].sort();
}

function templatesOf(
  root: string,
  name: string,
  candidates: string[],
): PluginPackagePreview["templates"] {
  const result: PluginPackagePreview["templates"] = [];
  const names = new Set<string>();
  const slug = (value: string): string =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "");
  for (const path of candidates) {
    const prefix =
      slug(name)
        .slice(0, 17)
        .replace(/^[^\p{L}\p{N}]+/u, "") || "plugin";
    const stem = (prefix + "-" + (slug(basename(path, extname(path))) || "prompt")).slice(0, 36);
    let command = stem;
    for (let index = 2; names.has(command); index++) command = stem + "-" + index;
    const text = readFileSync(path, "utf8")
      .replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)|^\ufeff/u, "")
      .replace(/\$ARGUMENTS|\$@/g, "{{arguments}}")
      .replace(/\$(\d{1,2})(?!\d)/g, "{{arg$1}}")
      .trim();
    if (
      !text ||
      text.length > PROMPT_TEMPLATE_TEXT_LIMIT ||
      !PROMPT_TEMPLATE_NAME_PATTERN.test(command)
    )
      continue;
    names.add(command);
    result.push({ name: command, path: relative(root, path).split(sep).join("/"), text });
    if (result.length === PROMPT_TEMPLATE_LIMIT) break;
  }
  return result;
}

export function readPackageManifest(
  snapshot: string,
  fallbackName: string,
  locations: ImportLocations,
): PackageManifest {
  const root = packageRoot(snapshot);
  const npm = json(join(root, "package.json"));
  const format = formatOf(root, npm);
  const issues: Parameters<typeof readPlugin>[4] = [];
  const plugin = readPlugin(
    format === "claude-code" || format === "skill" ? "claude-code" : "codex",
    root,
    fallbackName,
    locations,
    issues,
  );
  const pi = object(npm.pi);
  const paths = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const skillFiles = paths.filter((path) => basename(path) === "SKILL.md");
  const skillPaths =
    format === "pi"
      ? resourceFiles(root, skillFiles, pi.skills, ["skills"]).map(dirname)
      : plugin.skills;
  const name =
    (format === "pi" && typeof npm.name === "string" ? npm.name : plugin.name).trim() ||
    fallbackName;
  const version =
    (plugin.version ?? (typeof npm.version === "string" ? npm.version : undefined))?.trim() ||
    undefined;
  const promptFiles = resourceFiles(
    root,
    paths.filter((path) => /\.md$/i.test(path) && basename(path) !== "SKILL.md"),
    format === "pi" ? pi.prompts : (plugin.manifest.commands ?? plugin.manifest.prompts),
    ["prompts", "commands"],
  );
  const templates = templatesOf(root, name, promptFiles);
  const unsupported = new Set([
    ...plugin.unsupported
      .filter((item) => item !== "commands" || templates.length === 0)
      .map((item) => PACKAGE_UNSUPPORTED_LABELS.get(item) ?? item),
    ...issues.map((issue) => issue.name),
    ...(templates.length < promptFiles.length ? ["提示词模板"] : []),
  ]);
  if (existsSync(join(root, "extensions")) || pi.extensions !== undefined) unsupported.add("扩展");
  if (pi.themes !== undefined) unsupported.add("主题");
  if (npm.dependencies !== undefined || npm.optionalDependencies !== undefined)
    unsupported.add("npm 依赖");
  if (Object.keys(object(npm.scripts)).length) unsupported.add("npm 生命周期脚本");
  if (existsSync(join(root, ".gitmodules"))) unsupported.add("Git 子模块");
  const files = paths.map((path) => {
    const mode = statSync(path).mode & 0o111;
    return {
      path: relative(root, path).split(sep).join("/"),
      digest: createHash("sha256")
        .update(String(mode) + "\0")
        .update(readFileSync(path))
        .digest("hex"),
    };
  });
  return {
    root,
    name,
    version,
    format,
    files,
    skillPaths,
    templates,
    scripts: files.map(({ path }) => path).filter((path) => PACKAGE_SCRIPT.test(path)),
    servers: plugin.servers,
    configFiles: plugin.configFiles,
    unsupported: [...unsupported],
  };
}
