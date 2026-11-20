// @env browser
import type { WorkspaceEntry } from "@shared/contract";
import type { ComposerTrigger } from "./types";

export function composerTrigger(text: string, start: number, end: number): ComposerTrigger | null {
  if (start !== end) return null;
  const command = /^(\s*)\/([\p{L}\p{N}_-]*)$/u.exec(text);
  if (command && end === text.length) {
    return { kind: "command", start: command[1].length, end, query: command[2] };
  }

  const mention = /(^|[\s(（、，。！？\p{Script=Han}])@([^\s@)）、，。！？]*)$/u.exec(
    text.slice(0, end),
  );
  if (!mention) return null;
  const suffix = /^[^\s@)）、，。！？]*/u.exec(text.slice(end))?.[0] ?? "";
  return {
    kind: "reference",
    start: mention.index + mention[1].length,
    end: end + suffix.length,
    query: mention[2],
  };
}

export function promptWithReferences(
  text: string,
  references: readonly WorkspaceEntry[],
  heading: string,
): string {
  if (references.length === 0) return text;
  const paths = references.map(({ path, kind }) => {
    const reference = kind === "directory" ? path + "/" : path;
    return "- " + JSON.stringify(reference);
  });
  return [text, "", heading, ...paths].join("\n");
}
