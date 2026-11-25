// @env node
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from "../../../shared/web";

export const PLAN_TOOL_NAME = "update_plan";
export const PROPOSE_PLAN_TOOL_NAME = "propose_plan";
export const READ_SKILL_TOOL_NAME = "read_skill";
export const READ_BACKGROUND_TOOL_NAME = "read_background_command";
export const STOP_BACKGROUND_TOOL_NAME = "stop_background_command";

export const COMMAND_OUTPUT_LIMIT = 100_000;
export const COMMAND_TIMEOUT_MIN_SEC = 1;
export const COMMAND_TIMEOUT_DEFAULT_SEC = 60;
export const COMMAND_TIMEOUT_MAX_SEC = 300;
export const COMMAND_CLOSE_TIMEOUT_MS = 5_000;

export const TOOL_LABELS: Readonly<Record<string, string>> = {
  read_file: "读取文件",
  [READ_SKILL_TOOL_NAME]: "读取技能",
  [READ_BACKGROUND_TOOL_NAME]: "读取后台命令输出",
  [STOP_BACKGROUND_TOOL_NAME]: "停止后台命令",
  write_file: "写入文件",
  edit_file: "编辑文件",
  bash: "执行命令",
  glob: "查找文件",
  grep: "搜索内容",
  [WEB_FETCH_TOOL]: "读取网页",
  [WEB_SEARCH_TOOL]: "搜索网页",
  [PLAN_TOOL_NAME]: "任务计划",
  [PROPOSE_PLAN_TOOL_NAME]: "提交计划",
};
