#!/usr/bin/env node
// Generate .icns (Mac) and .ico (Win) icons from a source PNG.
// Usage: node make-icons.mjs <source.png>
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sharp = (await import("sharp")).default;

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || resolve(__dirname, "../../../mn.png");
if (!existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

// Pad/square the source image on a transparent canvas so all generated
// sizes are uniform. No trim: the current icon is already camera-ready
// with a dark background — trimming would eat into the dark space
// surrounding the brain.
async function squaredBuffer() {
  const meta = await sharp(src).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w === h) {
    return sharp(src).png().toBuffer();
  }
  const size = Math.max(w, h);
  const input = await sharp(src).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input,
        left: Math.floor((size - w) / 2),
        top: Math.floor((size - h) / 2),
      },
    ])
    .png()
    .toBuffer();
}

const trimmedSrc = await squaredBuffer();
console.log(`Source normalized to square canvas`);

const outDir = resolve(__dirname);
const iconsetDir = join(outDir, "icon.iconset");
rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });

// Mac .iconset standard sizes (Apple spec)
const macSizes = [
  { size: 16, name: "icon_16x16.png" },
  { size: 32, name: "icon_16x16@2x.png" },
  { size: 32, name: "icon_32x32.png" },
  { size: 64, name: "icon_32x32@2x.png" },
  { size: 128, name: "icon_128x128.png" },
  { size: 256, name: "icon_128x128@2x.png" },
  { size: 256, name: "icon_256x256.png" },
  { size: 512, name: "icon_256x256@2x.png" },
  { size: 512, name: "icon_512x512.png" },
  { size: 1024, name: "icon_512x512@2x.png" },
];

// Build a rounded-rect mask (macOS "squircle" approximation — 22.37% corner radius of the icon size).
// Apple uses a continuous squircle; a rounded-rect is a close approximation and acceptable for Electron.
function makeRoundedMaskSvg(size) {
  const r = Math.round(size * 0.2237);
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/>
  </svg>`;
}

// Apple HIG: the artwork's squircle bounding box is ~824/1024 ≈ 0.805 of
// the full canvas, with ~10% transparent safe-area on each side. Without
// this inset, the app icon appears visibly larger than other macOS icons
// in the dock and app switcher.
const INSET_FACTOR = 0.8;

async function renderInsetIcon(size) {
  const inner = Math.round(size * INSET_FACTOR);
  const mask = Buffer.from(makeRoundedMaskSvg(inner));
  // Masked content at the inset size
  const content = await sharp(trimmedSrc)
    .resize(inner, inner, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  // Center on the full-size transparent canvas
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: content,
        left: Math.floor((size - inner) / 2),
        top: Math.floor((size - inner) / 2),
      },
    ])
    .png()
    .toBuffer();
}

async function generate(size, filename) {
  const buf = await renderInsetIcon(size);
  writeFileSync(join(iconsetDir, filename), buf);
  console.log(`✓ ${filename} (${size}x${size})`);
}

console.log(`Source: ${src}`);
console.log(`Output: ${iconsetDir}`);

for (const { size, name } of macSizes) {
  await generate(size, name);
}

// Produce the .icns
const icnsPath = join(outDir, "icon.icns");
execSync(`iconutil -c icns -o "${icnsPath}" "${iconsetDir}"`);
console.log(`✓ ${icnsPath}`);

// Produce a 512x512 PNG for Linux/fallback
const pngPath = join(outDir, "icon.png");
const pngBuf = await renderInsetIcon(512);
writeFileSync(pngPath, pngBuf);
console.log(`✓ ${pngPath}`);

// Produce .ico (multi-size) for Windows using the PNG buffers we already generated
// Windows .ico can hold multiple PNG/BMP entries; we build one manually.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = [];
for (const s of icoSizes) {
  const png = await renderInsetIcon(s);
  icoImages.push({ size: s, png });
}

// ICO file structure
// ICONDIR (6 bytes) + n * ICONDIRENTRY (16 bytes) + image data
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(icoImages.length, 4);

const entries = [];
const imageBlobs = [];
let offset = 6 + 16 * icoImages.length;
for (const { size, png } of icoImages) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // image size
  entry.writeUInt32LE(offset, 12); // image offset
  entries.push(entry);
  imageBlobs.push(png);
  offset += png.length;
}

const icoBuf = Buffer.concat([header, ...entries, ...imageBlobs]);
writeFileSync(join(outDir, "icon.ico"), icoBuf);
console.log(`✓ ${join(outDir, "icon.ico")}`);

// Cleanup iconset temp dir
rmSync(iconsetDir, { recursive: true, force: true });

console.log("\nAll icons generated.");
