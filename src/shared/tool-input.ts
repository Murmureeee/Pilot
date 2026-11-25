// @env all
export function toolInput(source: string | undefined): { preview: string; details: string } {
  if (!source || source === "{}") return { preview: "", details: "" };
  try {
    const input: unknown = JSON.parse(source);
    if (!input || typeof input !== "object") return { preview: source, details: source };
    const fields = input as Record<string, unknown>;
    const primary = [fields.command, fields.path, fields.pattern, fields.url, fields.query].find(
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
