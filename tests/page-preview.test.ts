import { describe, expect, it } from "vitest";

import { localPreviewUrl, previewRequestAllowed } from "../src/shared/page-preview";

describe("local page previews", () => {
  it("accepts loopback HTTP and HTTPS and preserves paths and fragments", () => {
    expect(localPreviewUrl(" http://localhost:5173/app?tab=1#item ")?.href).toBe(
      "http://localhost:5173/app?tab=1#item",
    );
    expect(localPreviewUrl("https://127.0.0.1")?.href).toBe("https://127.0.0.1/");
    expect(localPreviewUrl("http://[::1]:3000")?.origin).toBe("http://[::1]:3000");
  });

  it("rejects credentials, non-local hosts and other schemes", () => {
    for (const address of [
      "file:///C:/project/index.html",
      "javascript:alert(0)",
      "ws://localhost:5173/",
      "http://local.host/",
      "http://localhost.example/",
      "http://0.0.0.0:5173/",
      "http://192.168.1.101:5173",
      "http://localhost@192.168.1.101:5173/",
      "https://user:password@localhost:5173/",
    ]) {
      expect(localPreviewUrl(address)).toBeNull();
    }
  });

  it("allows same-origin assets and hot reload while keeping other origins out", () => {
    const origin = "http://localhost:5173";
    expect(previewRequestAllowed(origin, origin + "/assets/site.css")).toBe(true);
    expect(previewRequestAllowed(origin, "ws://localhost:5173/")).toBe(true);
    expect(previewRequestAllowed(origin, "http://localhost:5174/")).toBe(false);
    expect(previewRequestAllowed(origin, "http://127.0.0.1:5173/")).toBe(false);
    expect(previewRequestAllowed(origin, "https://localhost:5173/")).toBe(false);
  });
});
