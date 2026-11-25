// @env browser
const parameter = /\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu;

export function promptParameters(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(parameter), ([, name]) => name))];
}

export function fillPromptTemplate(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(parameter, (placeholder, name: string) => values.get(name) ?? placeholder);
}
