// @env node
import type { CommandPrefix, CommandShell } from "@shared/contract";
import {
  BASH_WORD_CHARACTER,
  COMMAND_NAME,
  COMMAND_SCOPE_LIMIT,
  COMMAND_SUBSTITUTION_LIMIT,
  NON_LITERAL_CHARACTERS,
  POWERSHELL_SMART_QUOTES,
  POWERSHELL_WORD_CHARACTER,
  SHELL_KEYWORDS,
  WORD_BOUNDARY,
} from "./constants";
import type { ShellArgument } from "./types";

/**
 * 只识别可以静态确定命令边界的 Shell 语法。展开、重定向和其他未识别语法需要逐次审批。
 */
class CommandScopeParser {
  private offset = 0;
  private readonly commands: ShellArgument[][] = [];
  private readonly powershell: boolean;
  private readonly wordCharacter: RegExp;

  constructor(
    private readonly source: string,
    private readonly shell: CommandShell,
  ) {
    this.powershell = shell === "powershell";
    this.wordCharacter = this.powershell ? POWERSHELL_WORD_CHARACTER : BASH_WORD_CHARACTER;
  }

  parse(): ShellArgument[][] | undefined {
    return this.readList(0) && !this.peek() ? this.commands : undefined;
  }

  private peek(): string {
    return this.source[this.offset] ?? "";
  }

  private skipSpacing(newlines = false): void {
    const whitespace = newlines ? /[ \t\n]/ : /[ \t]/;
    while (whitespace.test(this.peek())) this.offset++;
  }

  private readList(depth: number): boolean {
    if (depth > COMMAND_SUBSTITUTION_LIMIT) return false;
    this.skipSpacing(true);
    while (this.readCommand(depth)) {
      const separator = this.peek();
      if (!separator || (separator === ")" && depth > 0)) return true;
      if (separator === "\n" || separator === ";") {
        this.offset++;
        this.skipSpacing(true);
        if (!this.peek() || (this.peek() === ")" && depth > 0)) return true;
        continue;
      }
      const pair = this.source.slice(this.offset, this.offset + 2);
      if (!this.powershell && (pair === "&&" || pair === "||" || pair === "|&")) {
        this.offset += 2;
      } else if (separator === "|" && pair !== "||" && pair !== "|&") {
        this.offset++;
      } else {
        return false;
      }
      this.skipSpacing(true);
    }
    return false;
  }

  private readCommand(depth: number): boolean {
    const start = this.offset;
    const head = this.readWord(depth);
    if (
      !head ||
      !COMMAND_NAME.test(head) ||
      SHELL_KEYWORDS[this.shell].has(this.powershell ? head.toLowerCase() : head) ||
      (this.powershell && head !== this.source.slice(start, this.offset))
    )
      return false;

    const args: ShellArgument[] = [head];
    this.skipSpacing();
    while (this.peek() && !WORD_BOUNDARY.test(this.peek())) {
      const arg = this.readWord(depth);
      if (arg === undefined) return false;
      args.push(arg);
      this.skipSpacing();
    }
    this.commands.push(args);
    return true;
  }

  private readWord(depth: number): ShellArgument | undefined {
    const start = this.offset;
    let value = "";
    let dynamic = false;
    while (this.peek() && !WORD_BOUNDARY.test(this.peek())) {
      const char = this.peek();
      if (char === "'" || char === '"' || char === "$") {
        if (this.powershell && start !== this.offset) return undefined;
        if (char === "$" && !this.readSubstitution(depth)) return undefined;
        const part = char === "$" ? null : this.readQuoted(char, depth);
        if (part === undefined) return undefined;
        if (part === null) dynamic = true;
        else value += part;
        if (this.powershell && this.peek() && !WORD_BOUNDARY.test(this.peek())) return undefined;
      } else if (!this.powershell && char === "\\") {
        const escaped = this.source[this.offset + 1];
        if (!escaped || NON_LITERAL_CHARACTERS.test(escaped)) return undefined;
        value += escaped;
        this.offset += 2;
      } else if (this.wordCharacter.test(char)) {
        value += char;
        this.offset++;
      } else {
        return undefined;
      }
    }
    if (this.offset === start || (this.powershell && value === "--%")) return undefined;
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
          if (this.powershell && (value.startsWith("-") || value.includes('"'))) return undefined;
          return dynamic ? null : value;
        }
      } else if (quote === '"' && (char === "$" || char === "\x60")) {
        if (!this.readSubstitution(depth)) return undefined;
        dynamic = true;
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

  private readSubstitution(depth: number): boolean {
    if (!this.source.startsWith("$(", this.offset)) return false;
    this.offset += 2;
    if (!this.readList(depth + 1) || this.peek() !== ")") return false;
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
  return new CommandScopeParser(source, shell).parse();
}

export function commandPrefixMatches(
  prefix: CommandPrefix,
  shell: CommandShell,
  args: ShellArgument[],
): boolean {
  return (
    prefix.shell === shell &&
    Boolean(prefix.args[0]) &&
    prefix.args.every((arg, index) => arg === args[index])
  );
}
