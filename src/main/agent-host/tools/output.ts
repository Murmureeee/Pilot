// @env node
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…（截断，共 ${text.length} 字符）`;
}

export function looksBinary(buffer: Buffer): boolean {
  const slice = buffer.subarray(0, 2048);
  return slice.includes(0);
}
