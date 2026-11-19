// @env node
export const PLAN_TOOL_NAME = "update_plan";

export const TOOL_LABELS: Readonly<Record<string, string>> = {
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  bash: "执行命令",
  glob: "查找文件",
  grep: "搜索内容",
  [PLAN_TOOL_NAME]: "任务计划",
};
