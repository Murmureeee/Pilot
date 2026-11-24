// @env node
import { COMMAND_OUTPUT_LIMIT } from "./constants";

function omissionNotice(omitted: number): string {
  return `\n…（省略 ${omitted} 字符）…\n`;
}

export class CommandOutput {
  private head = "";
  private tail = "";
  private length = 0;

  append(chunk: string): void {
    const half = COMMAND_OUTPUT_LIMIT / 2;
    this.length += chunk.length;
    const headSpace = half - this.head.length;
    this.head += chunk.slice(0, headSpace);
    this.tail = (this.tail + chunk.slice(headSpace).slice(-half)).slice(-half);
  }

  text(): string {
    if (this.length <= COMMAND_OUTPUT_LIMIT) return this.head + this.tail;
    // Reserve space for the notice and avoid splitting UTF-16 surrogate pairs at the cuts.
    const head = this.head.replace(/[\uD800-\uDBFF]$/u, "");
    const tail = this.tail
      .slice(omissionNotice(this.length).length)
      .replace(/^[\uDC00-\uDFFF]/u, "");
    return head + omissionNotice(this.length - head.length - tail.length) + tail;
  }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…（截断，共 ${text.length} 字符）`;
}

export function looksBinary(buffer: Buffer): boolean {
  const slice = buffer.subarray(0, 2048);
  return slice.includes(0);
}
