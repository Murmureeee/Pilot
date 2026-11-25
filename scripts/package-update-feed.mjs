// @env node

export function updateFeedArgs(source) {
  if (!source?.trim()) return [];
  const url = new URL(source.trim());
  if (url.username || url.password) throw new Error("PILOT_UPDATE_URL cannot contain credentials");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("PILOT_UPDATE_URL must use HTTPS or a local HTTP test server");
  }
  return ["-c.publish.provider=generic", `-c.publish.url=${url.href}`];
}
