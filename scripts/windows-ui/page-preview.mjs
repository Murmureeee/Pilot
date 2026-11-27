// @env node
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return "http://127.0.0.1:" + server.address().port;
}

const chinese = {
  locale: "zh",
  lang: "zh-CN",
  search: "搜索",
  command: "打开预览页签",
  tab: "预览",
  address: "本机开发服务器地址",
  screenshot: "将截图加入草稿",
  errors: "将控制台错误加入草稿",
};
const english = {
  locale: "en",
  lang: "en",
  search: "Search",
  command: "Open the Preview tab",
  tab: "Preview",
  address: "Local development server URL",
  screenshot: "Attach screenshot to draft",
  errors: "Add console errors to draft",
};

async function openPanel(page, words) {
  await page.locator("[data-composer-editor]").waitFor();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("textbox", { name: words.search, exact: true });
  await search.fill(words.command);
  await search.press("Enter");
  const activeTab = page.getByRole("tab", { name: words.tab, exact: true, selected: true });
  await activeTab.and(page.locator(":focus")).waitFor();
  const preview = page.getByRole("tabpanel", { name: words.tab, exact: true });
  const input = preview.getByRole("textbox", { name: words.address });
  return { preview, input };
}

async function verifyLayouts(page, app, address) {
  const window = await app.browserWindow(page);
  for (const [width, height, zoom] of [
    [1100, 750, 1],
    [720, 480, 1],
    [720, 480, 1.5],
  ]) {
    await window.evaluate(
      (win, [w, h, factor]) => {
        win.webContents.setZoomFactor(factor);
        win.setContentSize(w, h);
      },
      [width, height, zoom],
    );
    await page.waitForFunction(
      ([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1,
      [width / zoom, height / zoom],
    );
    for (const words of [chinese, english]) {
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          ([locale, theme]) => {
            localStorage.setItem("pilot-locale", locale);
            localStorage.setItem("pilot-theme", theme);
          },
          [words.locale, theme],
        );
        await page.reload();
        await page.waitForFunction(
          ([lang, dark]) =>
            document.documentElement.lang === lang &&
            document.documentElement.classList.contains("dark") === dark,
          [words.lang, theme === "dark"],
        );
        const { preview, input } = await openPanel(page, words);
        await input.fill(address);
        await input.press("Enter");
        const screenshot = preview.getByRole("button", { name: words.screenshot });
        const errors = preview.getByRole("button", { name: words.errors });
        await screenshot.waitFor();
        const fit = await preview.evaluate((panel) => {
          const bounds = panel.getBoundingClientRect();
          const controls = [...panel.querySelectorAll("button, input, webview")];
          return controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.left >= bounds.left - 1 &&
              rect.right <= bounds.right + 1 &&
              rect.top >= bounds.top - 1 &&
              rect.bottom <= bounds.bottom + 1 &&
              control.scrollWidth <= control.clientWidth + 1
            );
          });
        });
        assert.ok(
          fit,
          "Preview controls fit at " + [width, height, zoom, words.lang, theme].join(" "),
        );
        await errors.and(page.locator(":enabled")).waitFor();
        await errors.focus();
        await errors.press("Escape");
        await preview.waitFor({ state: "hidden" });
      }
    }
  }
}

export async function verifyPagePreview(page, app) {
  let foreignRequests = 0;
  const foreign = createServer((_request, response) => {
    foreignRequests += 1;
    response.end("foreign");
  });
  const foreignOrigin = await listen(foreign);
  const development = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: foreignOrigin + "/" });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><meta charset=utf-8><h1>Preview fixture</h1>" +
        "<script>console.error('preview fixture error');" +
        "fetch(" +
        JSON.stringify(foreignOrigin + "/cross-origin") +
        ").catch(() => {});" +
        "</script>",
    );
  });
  const address = (await listen(development)) + "/";
  try {
    const { preview, input } = await openPanel(page, chinese);
    await input.fill("https://example.com/");
    await input.press("Enter");
    await preview
      .getByRole("alert")
      .getByText("请输入本机开发服务器的 HTTP 或 HTTPS 地址。")
      .waitFor();
    await input.fill(address + "redirect");
    await input.press("Enter");
    await preview
      .getByRole("alert")
      .getByText(/打开页面失败/)
      .waitFor();
    await input.fill(address);
    await input.press("Enter");
    const screenshot = preview.getByRole("button", { name: "将截图加入草稿" });
    await screenshot.waitFor();
    const guest = await app.evaluate(async ({ webContents }, expected) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL() === expected);
      return (
        contents && {
          preview: await contents.executeJavaScript("document.querySelector('h1').textContent"),
          hostApi: await contents.executeJavaScript("typeof window.pi"),
          require: await contents.executeJavaScript("typeof window.require"),
          isolated: !contents.session.storagePath,
        }
      );
    }, address);
    assert.deepEqual(guest, {
      preview: "Preview fixture",
      hostApi: "undefined",
      require: "undefined",
      isolated: true,
    });
    assert.equal(foreignRequests, 0, "Preview blocked requests outside its origin");
    const consoleErrors = preview.getByRole("button", { name: "将控制台错误加入草稿" });
    await page.waitForFunction((button) => !button.disabled, await consoleErrors.elementHandle());
    await screenshot.click();
    const composer = page.locator("[data-composer-editor]");
    await composer.getByText("preview fixture error", { exact: false }).waitFor();
    await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
    const snapshot = await page.evaluate(() => window.pi.getSnapshot());
    assert.ok(
      snapshot.draftImages.some(
        ({ name, data }) => name === "page-preview.jpg" && data.length > 100,
      ),
    );
    assert.equal(snapshot.messages.length, 0);
    await verifyLayouts(page, app, address);
    assert.equal(foreignRequests, 0);
  } finally {
    await Promise.all(
      [development, foreign].map((server) => {
        const closed = once(server, "close");
        server.close();
        server.closeAllConnections();
        return closed;
      }),
    );
  }
}
