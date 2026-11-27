// @env node
import type { CommandPrefix, CommandShell } from "@shared/contract";

import {
  BASH_WORD_CHARACTER,
  COMMAND_NAME,
  COMMAND_SCOPE_LIMIT,
  COMMAND_SUBSTITUTION_LIMIT,
  INSPECTION_WORD_BOUNDARY,
  NON_LITERAL_CHARACTERS,
  POWERSHELL_SMART_QUOTES,
  POWERSHELL_WORD_CHARACTER,
  REDIRECTION_OPERATOR,
  SHELL_DYNAMIC_CHARACTER,
  SHELL_KEYWORDS,
  SHELL_VARIABLE,
  WORD_BOUNDARY,
} from "./constants";
import type { ShellArgument, ShellCommand, ShellPipeline } from "./types";

class ShellCommandParser {
  private offset = 0;
  private readonly commands: ShellCommand[] = [];
  private readonly powershell: boolean;
  private readonly wordCharacter: RegExp;
  private readonly wordBoundary: RegExp;

  constructor(
    private readonly source: string,
    private readonly shell: CommandShell,
    private readonly inspecting: boolean,
  ) {
    this.powershell = shell === "powershell";
    this.wordCharacter = this.powershell ? POWERSHELL_WORD_CHARACTER : BASH_WORD_CHARACTER;
    this.wordBoundary = inspecting ? INSPECTION_WORD_BOUNDARY : WORD_BOUNDARY;
  }

  parse(): ShellCommand[] | undefined {
    const complete = this.readList(0) && !this.peek();
    return complete || this.inspecting ? this.commands : undefined;
  }

  private peek(): string {
    return this.source[this.offset] ?? "";
  }

  private skipSpacing(newlines = false): void {
    const whitespace = newlines ? /[ \t\n]/ : /[ \t]/;
    while (whitespace.test(this.peek())) this.offset++;
  }

  private readList(depth: number, closer = "", output?: ShellPipeline): boolean {
    if (depth > COMMAND_SUBSTITUTION_LIMIT) return false;
    let pipeline: ShellPipeline = { output };
    this.skipListSpacing();
    while (this.readCommand(depth, pipeline)) {
      const separator = this.peek();
      if (!separator || separator === closer) return true;
      const pair = this.source.slice(this.offset, this.offset + 2);
      if (
        separator === "\n" ||
        separator === ";" ||
        (this.inspecting && !this.powershell && separator === "&" && pair !== "&&")
      ) {
        this.offset++;
        pipeline = { output };
        this.skipListSpacing();
        if (!this.peek() || this.peek() === closer) return true;
        continue;
      }
      if (
        (!this.powershell || this.inspecting) &&
        (pair === "&&" || pair === "||" || pair === "|&")
      ) {
        this.offset += 2;
        if (pair !== "|&") pipeline = { output };
      } else if (separator === "|" && pair !== "||" && pair !== "|&") {
        this.offset++;
      } else {
        return false;
      }
      this.skipListSpacing();
    }
    return false;
  }

  private skipListSpacing(): void {
    this.skipSpacing(true);
    while (this.inspecting && this.peek() === "#") {
      this.skipComment();
      this.skipSpacing(true);
    }
  }

  private skipComment(): void {
    const end = this.source.indexOf("\n", this.offset);
    this.offset = end === -1 ? this.source.length : end;
  }

  private readCommand(depth: number, pipeline: ShellPipeline): boolean {
    if (this.inspecting && this.powershell && this.peek() === "&") {
      this.offset++;
      this.skipSpacing();
    }
    if (this.inspecting && (this.peek() === "(" || this.peek() === "{")) {
      if (!this.readGroup(depth, this.peek() === "(" ? ")" : "}", pipeline)) return false;
      if (this.powershell && this.peek() === ".") this.readWord(depth);
      this.skipSpacing();
      return true;
    }
    const start = this.offset;
    const head = this.readWord(depth);
    if (head === undefined) return false;
    if (
      !this.inspecting &&
      (!head ||
        !COMMAND_NAME.test(head) ||
        SHELL_KEYWORDS[this.shell].has(this.powershell ? head.toLowerCase() : head) ||
        (this.powershell && head !== this.source.slice(start, this.offset)))
    )
      return false;

    const args: ShellArgument[] = [head];
    this.skipSpacing();
    while (this.peek() && !WORD_BOUNDARY.test(this.peek())) {
      const char = this.peek();
      if (this.inspecting && char === "}") break;
      if (this.inspecting && char === "#") {
        this.skipComment();
        break;
      }
      if (this.inspecting && (char === ">" || char === "<")) {
        if (!this.readRedirection(depth)) break;
        this.skipSpacing();
        continue;
      }
      if (this.inspecting && (char === "(" || char === "{")) {
        if (!this.readGroup(depth, char === "(" ? ")" : "}")) break;
        args.push(null);
        this.skipSpacing();
        continue;
      }
      const arg = this.readWord(depth);
      if (arg === undefined) {
        if (!this.inspecting) return false;
        args.push(null);
        break;
      }
      args.push(arg);
      this.skipSpacing();
    }
    this.commands.push({ args, pipeline });
    return true;
  }

  private readRedirection(depth: number): boolean {
    const operator = REDIRECTION_OPERATOR.exec(this.source.slice(this.offset))?.[0];
    if (!operator) return false;
    this.offset += operator.length;
    this.skipSpacing();
    return this.readWord(depth) !== undefined;
  }

  private readWord(depth: number): ShellArgument | undefined {
    const start = this.offset;
    let value = "";
    let dynamic = false;
    while (this.peek() && !this.wordBoundary.test(this.peek())) {
      const char = this.peek();
      if (char === "'" || char === '"' || char === "$") {
        if (!this.inspecting && this.powershell && start !== this.offset) return undefined;
        if (char === "$" && !this.readExpansion(depth)) return undefined;
        const part = char === "$" ? null : this.readQuoted(char, depth);
        if (part === undefined) return undefined;
        if (part === null) dynamic = true;
        else value += part;
        if (!this.inspecting && this.powershell && this.peek() && !WORD_BOUNDARY.test(this.peek()))
          return undefined;
      } else if (this.inspecting && this.powershell && char === "\x60") {
        const next = this.source[this.offset + 1];
        if (!next) return undefined;
        if (next !== "\n") value += next;
        this.offset += 2;
      } else if (!this.powershell && char === "\\") {
        const escaped = this.source[this.offset + 1];
        if (this.inspecting && escaped === "\n") {
          this.offset += 2;
          continue;
        }
        if (!escaped || NON_LITERAL_CHARACTERS.test(escaped)) return undefined;
        value += escaped;
        this.offset += 2;
      } else if (this.wordCharacter.test(char)) {
        value += char;
        this.offset++;
      } else if (this.inspecting && !NON_LITERAL_CHARACTERS.test(char)) {
        if (SHELL_DYNAMIC_CHARACTER.test(char) || (this.powershell && char === ",")) dynamic = true;
        value += char;
        this.offset++;
      } else {
        return undefined;
      }
    }
    if (this.offset === start || (!this.inspecting && this.powershell && value === "--%"))
      return undefined;
    return dynamic ? null : value;
  }

  private readQuoted(quote: "'" | '"', depth: number): ShellArgument | undefined {
    this.offset++;
    let value = "";
    let dynamic = false;
    while (this.peek()) {
      const char = this.peek();
      if (NON_LITERAL_CHARACTERS.test(char)) return undefined;
      if (this.powershell && POWERSHELL_SMART_QUOTES.test(char)) return undefined;
      if (char === quote) {
        this.offset++;
        if (!this.powershell || this.peek() !== quote) {
          // PowerShell distinguishes parameter syntax from quoted strings.
          if (!this.inspecting && this.powershell && (value.startsWith("-") || value.includes('"')))
            return undefined;
          return dynamic ? null : value;
        }
      } else if (quote === '"' && char === "$") {
        if (!this.readExpansion(depth)) return undefined;
        dynamic = true;
        continue;
      } else if (quote === '"' && char === "\x60") {
        if (!this.inspecting || !this.powershell || !this.source[this.offset + 1]) return undefined;
        value += this.source[this.offset + 1];
        this.offset += 2;
        continue;
      } else if (!this.powershell && quote === '"' && char === "\\") {
        const escaped = this.source[this.offset + 1];
        if (escaped && ['"', "$", "\x60", "\\"].includes(escaped)) {
          value += escaped;
          this.offset += 2;
          continue;
        }
      }
      value += char;
      this.offset++;
    }
    return undefined;
  }

  private readExpansion(depth: number): boolean {
    if (this.source.startsWith("$(", this.offset)) {
      this.offset++;
      return this.readGroup(depth, ")");
    }
    if (!this.inspecting) return false;
    const variable = SHELL_VARIABLE.exec(this.source.slice(this.offset))?.[0];
    if (!variable) return false;
    this.offset += variable.length;
    return true;
  }

  private readGroup(depth: number, closer: string, output?: ShellPipeline): boolean {
    this.offset++;
    if (!this.readList(depth + 1, closer, output) || this.peek() !== closer) return false;
    this.offset++;
    return true;
  }
}

export function parseCommandScope(
  command: string,
  shell: CommandShell,
): ShellArgument[][] | undefined {
  if (command.length > COMMAND_SCOPE_LIMIT) return undefined;
  const source = shell === "powershell" ? command.replace(/\r\n?/g, "\n") : command;
  return new ShellCommandParser(source, shell, false).parse()?.map(({ args }) => args);
}

// 检查时保留已识别的命令，便于发现出现在展开或重定向旁边的危险操作。
export function inspectShellCommand(command: string, shell: CommandShell): ShellCommand[] {
  const lines = command.replace(/\r\n?/g, "\n");
  const source =
    shell === "powershell" ? lines.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"') : lines;
  return new ShellCommandParser(source, shell, true).parse() ?? [];
}

export function commandPrefixMatches(
  prefix: CommandPrefix,
  shell: CommandShell,
  args: ShellArgument[],
  wslDistribution?: string,
): boolean {
  return (
    prefix.shell === shell &&
    prefix.wslDistribution?.toLowerCase() === wslDistribution?.toLowerCase() &&
    Boolean(prefix.args[0]) &&
    prefix.args.every((arg, index) => arg === args[index])
  );
}
