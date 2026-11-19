// 从 resources/icon.svg 生成应用图标资产：
//   icon.png（512，dev 窗口/任务栏用）+ icon.ico（多尺寸，打包用 electron-builder）
// 用法：node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = process.cwd();
const svgPath = join(root, "resources", "icon.svg");
const svg = readFileSync(svgPath);

// 512 PNG：dev 窗口图标（Electron 的 BrowserWindow.icon 接受 png）
await sharp(svg, { density: 72 })
  .resize(512, 512)
  .png()
  .toFile(join(root, "resources", "icon.png"));

// 多尺寸 ICO：Windows 打包后嵌入 exe / 任务栏
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map((size) =>
    sharp(svg, { density: (72 * size) / 16 })
      .resize(size, size)
      .png()
      .toBuffer(),
  ),
);
const ico = await pngToIco(pngs);
writeFileSync(join(root, "resources", "icon.ico"), ico);
console.log("[make-icons] icon.png (512) + icon.ico (16–256) 已生成");
