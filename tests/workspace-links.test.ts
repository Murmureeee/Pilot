// @env browser
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultRemarkPlugins, Streamdown, type ExtraProps } from "streamdown";
import { expect, it } from "vitest";
import {
  remarkWorkspaceLinks,
  workspaceLinkFromHref,
} from "../src/renderer/src/lib/workspace-links";

it("keeps Windows file links and workspace-relative references through sanitization", () => {
  const links = [
    { type: "link", url: "E:/temp/test/aa.txt" },
    { type: "link", url: "src/Quarterly%20report%20%5Bdraft%5D.md#L12-L15" },
    { type: "link", url: "file:///E:/temp/test/src/index.ts:6" },
    { type: "link", url: "src/main/ipc/" },
    { type: "link", url: "https://example.org/file.ts#L1" },
    { type: "image", url: "assets/image.png" },
  ];
  remarkWorkspaceLinks()({ children: links });
  for (const link of links.slice(0, 4)) expect(link.url).toMatch(/^#pilot-workspace-reference=/);
  expect(links[4].url).toBe("https://example.org/file.ts#L1");
  expect(links[5].url).toBe("assets/image.png");
  expect(
    links.map((link) => workspaceLinkFromHref(link.type === "link" ? link.url : undefined)),
  ).toEqual([
    { path: "E:/temp/test/aa.txt", kind: "file" },
    { path: "src/Quarterly report [draft].md", kind: "file", line: 12 },
    { path: "E:/temp/test/src/index.ts", kind: "file", line: 6 },
    { path: "src/main/ipc/", kind: "directory" },
    undefined,
    undefined,
  ]);
  for (const url of [
    "#heading",
    "file://server/share/file.txt",
    "//example.org/file.txt",
    "mailto:pilot@example.org",
    "javascript:alert(1)",
    "src/%00.txt",
  ]) {
    expect(workspaceLinkFromHref(url)).toBeUndefined();
  }
});

it("recovers a Windows path from Streamdown's sanitized fragment URL", () => {
  const html = renderToStaticMarkup(
    createElement(
      Streamdown,
      {
        mode: "static",
        remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkWorkspaceLinks],
        components: {
          a: ({ href, children }: ComponentProps<"a"> & ExtraProps) =>
            createElement(
              "span",
              { "data-workspace-path": workspaceLinkFromHref(href)?.path },
              children,
            ),
        },
      },
      "已将文件重命名为 [aa.txt](<E:/temp/test/aa.txt>)。",
    ),
  );
  expect(html).toContain('<span data-workspace-path="E:/temp/test/aa.txt">aa.txt</span>');
  expect(html).not.toContain("[blocked]");
});
