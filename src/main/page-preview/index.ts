// @env node
import { createHash } from "node:crypto";

import { session, type Session, type WebContents } from "electron";

import { IMAGE_ATTACHMENT_MAX_BYTES } from "../../shared/constants";
import {
  localPreviewUrl,
  PREVIEW_PARTITION,
  previewRequestAllowed,
  type PagePreviewReport,
} from "../../shared/page-preview";
import {
  PREVIEW_ERROR_LIMIT,
  PREVIEW_ERROR_MAX_LENGTH,
  PREVIEW_MAX_IMAGE_DIMENSION,
} from "./constants";
import type { PagePreviewGuest } from "./types";

const owners = new WeakMap<WebContents, Map<number, PagePreviewGuest>>();
const origins = new Map<string, Promise<Session>>();
const ready = new Map<string, Session>();
const sessionOrigins = new WeakMap<Session, string>();

async function createPreviewSession(origin: string): Promise<Session> {
  const hash = createHash("sha256").update(origin).digest("hex");
  const isolated = session.fromPartition(PREVIEW_PARTITION + "-" + hash, { cache: false });
  await isolated.setProxy({ mode: "direct" });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  isolated.on("will-download", (event) => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !previewRequestAllowed(origin, details.url) });
  });
  sessionOrigins.set(isolated, origin);
  ready.set(origin, isolated);
  return isolated;
}

export async function preparePagePreview(address: string): Promise<string> {
  const url = localPreviewUrl(address);
  if (!url) throw new Error("请输入本机开发服务器的 HTTP 或 HTTPS 地址。");
  let pending = origins.get(url.origin);
  if (!pending) {
    pending = createPreviewSession(url.origin);
    origins.set(url.origin, pending);
  }
  try {
    await pending;
  } catch (cause) {
    if (origins.get(url.origin) === pending) origins.delete(url.origin);
    throw cause;
  }
  return url.href;
}

export function registerPagePreview(owner: WebContents): void {
  const owned = new Map<number, PagePreviewGuest>();
  owners.set(owner, owned);
  owner.on("will-attach-webview", (event, preferences, params) => {
    const address = localPreviewUrl(params.src ?? "");
    const isolated = address && ready.get(address.origin);
    if (!address || !isolated || params.partition !== PREVIEW_PARTITION) {
      event.preventDefault();
      return;
    }
    // Webview attributes must never grant the guest access to the host process.
    delete preferences.preload;
    delete preferences.additionalArguments;
    delete preferences.enableBlinkFeatures;
    delete preferences.experimentalFeatures;
    Object.assign(preferences, {
      session: isolated,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      plugins: false,
      disablePopups: true,
    });
    delete params.httpreferrer;
    delete params.useragent;
    params.src = address.href;
  });
  owner.on("did-attach-webview", (_event, contents) => {
    const origin = sessionOrigins.get(contents.session);
    if (!origin) {
      contents.close();
      return;
    }
    const guest: PagePreviewGuest = { contents, origin, errors: [] };
    const id = contents.id;
    owned.set(id, guest);
    contents.once("destroyed", () => {
      owned.delete(id);
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    contents.on("will-frame-navigate", (event) => {
      if (!previewRequestAllowed(guest.origin, event.url)) event.preventDefault();
    });
    contents.on("will-redirect", (event) => {
      if (!previewRequestAllowed(guest.origin, event.url)) event.preventDefault();
    });
    contents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument) guest.errors.length = 0;
    });
    contents.on("console-message", (event) => {
      if (event.level !== "error") return;
      const message = event.message.slice(0, PREVIEW_ERROR_MAX_LENGTH).trim();
      if (!message) return;
      guest.errors.push(message);
      if (guest.errors.length > PREVIEW_ERROR_LIMIT) guest.errors.shift();
    });
  });
}

export async function pagePreviewReport(
  owner: WebContents,
  id: number,
  includeScreenshot: boolean,
): Promise<PagePreviewReport> {
  const guest = owners.get(owner)?.get(id);
  const address = guest && localPreviewUrl(guest.contents.getURL());
  if (!guest || !address || address.origin !== guest.origin) {
    throw new Error("页面预览已关闭，请重新打开。");
  }
  const report: PagePreviewReport = { address: address.href, errors: [...guest.errors] };
  if (!includeScreenshot) return report;

  let image = await guest.contents.capturePage();
  if (
    image.isEmpty() ||
    guest.contents.isDestroyed() ||
    guest.contents.getURL() !== report.address
  ) {
    throw new Error("无法截取预览页面，请等待页面加载后重试。");
  }
  const size = image.getSize();
  const scale = PREVIEW_MAX_IMAGE_DIMENSION / Math.max(size.width, size.height);
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.floor(size.width * scale)) });
  const bytes = image.toJPEG(85);
  if (bytes.length > IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error("页面截图过大，请缩小预览区域后重试。");
  }
  report.screenshot = {
    type: "image",
    name: "page-preview.jpg",
    mimeType: "image/jpeg",
    data: bytes.toString("base64"),
  };
  return report;
}
