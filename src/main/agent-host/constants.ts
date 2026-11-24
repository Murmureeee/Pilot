// @env node
import type { CommandShell } from "@shared/contract";

export const COMMAND_SCOPE_LIMIT = 32_768;
export const COMMAND_SUBSTITUTION_LIMIT = 16;
export const BASH_WORD_CHARACTER = /[a-zA-Z0-9_./:@%+,=-]/;
export const POWERSHELL_WORD_CHARACTER = /[a-zA-Z0-9_./:\\%+=-]/;
export const COMMAND_NAME = /^[a-zA-Z_./\\][a-zA-Z0-9_./:\\+-]*$/;
export const SHELL_KEYWORDS: Record<CommandShell, ReadonlySet<string>> = {
  bash: new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "in",
    "select",
    "function",
    "time",
    "coproc",
  ]),
  powershell: new Set([
    "begin",
    "break",
    "catch",
    "class",
    "continue",
    "data",
    "define",
    "do",
    "dynamicparam",
    "else",
    "elseif",
    "end",
    "enum",
    "exit",
    "filter",
    "finally",
    "for",
    "foreach",
    "from",
    "function",
    "if",
    "in",
    "param",
    "process",
    "return",
    "switch",
    "throw",
    "trap",
    "try",
    "until",
    "using",
    "var",
    "while",
    "workflow",
  ]),
};

export const WORD_BOUNDARY = /[ \t\n;|&)]/;
export const NON_LITERAL_CHARACTERS = /[\p{C}\p{Zl}\p{Zp}]/u;
export const POWERSHELL_SMART_QUOTES = /[‘’‚‛“”„‟]/;
