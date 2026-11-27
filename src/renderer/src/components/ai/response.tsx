// @env browser
// 流式 Markdown 渲染：Streamdown（流式安全的增量解析 + 代码高亮内置）。
import { memo, type ComponentProps, type JSX } from "react";
import {
  defaultComponents,
  defaultRemarkPlugins,
  Streamdown,
  type ExtraProps,
  type StreamdownTranslations,
} from "streamdown";

import { t, useLocale } from "@renderer/lib/i18n";
import { remarkWorkspaceLinks, workspaceLinkFromHref } from "@renderer/lib/workspace-links";

import { InlineWorkspaceReference } from "./workspace-reference";

const MARKDOWN_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkWorkspaceLinks];
const DefaultLink = defaultComponents.a;

function MarkdownLink(props: ComponentProps<"a"> & ExtraProps): JSX.Element {
  const reference = workspaceLinkFromHref(props.href);
  return reference ? (
    <InlineWorkspaceReference {...reference}>{props.children}</InlineWorkspaceReference>
  ) : (
    <DefaultLink {...props} />
  );
}

const MARKDOWN_COMPONENTS = { a: MarkdownLink };

const ZH_TRANSLATIONS = {
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
} satisfies Partial<StreamdownTranslations>;

const ZH_TW_TRANSLATIONS = Object.fromEntries(
  Object.entries(ZH_TRANSLATIONS).map(([key, message]) => [key, t(message, "zh-TW")]),
);

export const Response = memo(function Response({ content }: { content: string }): JSX.Element {
  const locale = useLocale();
  return (
    <Streamdown
      components={MARKDOWN_COMPONENTS}
      remarkPlugins={MARKDOWN_PLUGINS}
      translations={
        locale === "en" ? undefined : locale === "zh" ? ZH_TRANSLATIONS : ZH_TW_TRANSLATIONS
      }
    >
      {content}
    </Streamdown>
  );
});
