// @env node
import type { CommandShell, ModelCapabilities, ModelPricing } from "@shared/contract";

export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  contextWindow: 128_000,
  maxTokens: 8_192,
  supportsImages: false,
  supportsThinking: false,
};
export const DEFAULT_MODEL_PRICING: ModelPricing = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export const MODEL_RETRY_ATTEMPTS = 3;
export const MODEL_RETRY_POLICY = { baseDelayMs: 1000, maxAgentDelayMs: 60_000 };
export const MODEL_ERROR_DETAIL_LIMIT = 12_000;

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
export const INSPECTION_WORD_BOUNDARY = /[ \t\n;|&(){}<>]/;
export const SHELL_VARIABLE = /^\$(?:\{[\w:.-]+\}|[\w:]+|[?*!#$@-])/;
export const SHELL_DYNAMIC_CHARACTER = /[*?[\]~@]/;
export const REDIRECTION_OPERATOR = /^(?:>>?[&]?|<)(?!<)/;
export const NON_LITERAL_CHARACTERS = /[\p{C}\p{Zl}\p{Zp}]/u;
export const POWERSHELL_SMART_QUOTES = /[‘’‚‛“”„‟]/;

export const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
]);
export const COMMAND_WRAPPERS = new Set(["command", "env", "exec", "nohup", "sudo", "time"]);
export const COMMAND_INTRODUCERS = new Set([
  "!",
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
]);
export const WRAPPER_OPTIONS_WITH_VALUE = new Set([
  "-u",
  "-g",
  "-h",
  "-p",
  "-C",
  "-D",
  "--unset",
  "--chdir",
  "--user",
  "--group",
]);
export const DOWNLOAD_COMMANDS = new Set([
  "curl",
  "wget",
  "invoke-webrequest",
  "invoke-restmethod",
  "iwr",
  "irm",
]);
export const STREAM_EXECUTORS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "powershell",
  "pwsh",
  "invoke-expression",
  "iex",
]);
export const DISK_COMMANDS = new Set([
  "diskpart",
  "format",
  "fdisk",
  "cfdisk",
  "sfdisk",
  "gdisk",
  "sgdisk",
  "parted",
  "wipefs",
  "mkswap",
  "new-partition",
  "remove-partition",
  "resize-partition",
  "initialize-disk",
  "clear-disk",
  "set-disk",
  "set-partition",
  "format-volume",
]);
export const SYSTEM_COMMANDS = new Set([
  "shutdown",
  "restart-computer",
  "stop-computer",
  "remove-itemproperty",
  "set-mppreference",
  "remove-mppreference",
]);
export const LOCATION_COMMANDS = new Set([
  "cd",
  "chdir",
  "pushd",
  "popd",
  "sl",
  "set-location",
  "push-location",
  "pop-location",
]);
export const DELETE_COMMANDS = new Set(["rm", "remove-item", "ri", "rmdir", "rd", "del", "erase"]);
export const CMD_DELETE_COMMANDS = new Set(["rmdir", "rd", "del", "erase"]);
export const POWERSHELL_DELETE_OPTIONS_WITH_VALUE = new Set([
  "-exclude",
  "-include",
  "-filter",
  "-erroraction",
  "-ea",
  "-errorvariable",
  "-ev",
  "-warningaction",
  "-wa",
  "-warningvariable",
  "-wv",
  "-informationaction",
  "-infa",
  "-informationvariable",
  "-iv",
  "-outvariable",
  "-ov",
  "-outbuffer",
  "-ob",
  "-pipelinevariable",
  "-pv",
]);
export const UNSAFE_DELETE_TARGET = /[*?[\]{}~]|\0/;
export const DRIVE_MOUNT_PATH = /^\/([a-z])(?:\/|$)/i;
export const WINDOWS_DRIVE = /^[a-z]:/i;
