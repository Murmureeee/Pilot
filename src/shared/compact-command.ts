// @env all
export function compactFocus(text: string): string | undefined {
  const command = /^\/compact(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return command ? (command[1]?.trim() ?? "") : undefined;
}
