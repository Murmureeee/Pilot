// pnpm 重链接依赖会清掉 electron 的二进制产物且不会重跑其 postinstall。
// 本脚本在每次 install 后检查，缺失时从缓存恢复。
// 默认走 npmmirror 镜像（GitHub 直连在国内网络不可用）；已导出 ELECTRON_MIRROR 时不覆盖。
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const electronDir = join(process.cwd(), "node_modules", "electron");

if (!existsSync(join(electronDir, "path.txt"))) {
  console.log("[restore-electron] electron 二进制缺失，正在从缓存恢复…");
  const env = { ...process.env };
  if (!env.ELECTRON_MIRROR) {
    env.ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
  }
  execSync("node install.js", { cwd: electronDir, stdio: "inherit", env });
  console.log("[restore-electron] 恢复完成");
}
