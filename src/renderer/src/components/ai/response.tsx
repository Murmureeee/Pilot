// @env browser
// 流式 Markdown 渲染：Streamdown（流式安全的增量解析 + 代码高亮内置）。
import { memo, type JSX } from "react";
import { Streamdown, type StreamdownTranslations } from "streamdown";
import { useAgentStore } from "@renderer/stores/agent";

const ZH_TRANSLATIONS: Partial<StreamdownTranslations> = {
  close: "关闭",
  copied: "已复制",
  copyCode: "复制代码",
  copyLink: "复制链接",
  copyTable: "复制表格",
  copyTableAsCsv: "复制为 CSV",
  copyTableAsMarkdown: "复制为 Markdown",
  copyTableAsTsv: "复制为 TSV",
  downloadDiagram: "下载图表",
  downloadDiagramAsMmd: "下载为 MMD",
  downloadDiagramAsPng: "下载为 PNG",
  downloadDiagramAsSvg: "下载为 SVG",
  downloadFile: "下载文件",
  downloadImage: "下载图片",
  downloadTable: "下载表格",
  downloadTableAsCsv: "下载为 CSV",
  downloadTableAsMarkdown: "下载为 Markdown",
  errorMermaid: "无法显示 Mermaid 图表",
  exitFullscreen: "退出全屏",
  externalLinkWarning: "即将打开外部网站。",
  imageNotAvailable: "图片无法显示",
  mermaidAriaLabel: "Mermaid 图表",
  openExternalLink: "打开外部链接？",
  openLink: "打开链接",
  resetView: "重置缩放与位置",
  viewFullscreen: "全屏显示",
  zoomIn: "放大",
  zoomOut: "缩小",
};

export const Response = memo(function Response({ content }: { content: string }): JSX.Element {
  const locale = useAgentStore((s) => s.locale);
  return (
    <Streamdown translations={locale === "zh" ? ZH_TRANSLATIONS : undefined}>{content}</Streamdown>
  );
});
