/* crop_png.mjs —— 裁掉截图两侧的空白边（纯 Node，无第三方依赖）
 *
 * 为什么需要：Chrome 无头模式把 390px 宽的页面渲染在更宽的画布里并居中，
 * 截图会带黑边。裁掉黑边才能用于 README。
 *
 * 用法：node tools/crop_png.mjs <输入.png> <输出.png> [阈值]
 */

import fs from "node:fs";
import zlib from "node:zlib";

const [, , inFile, outFile, thrArg] = process.argv;
if (!inFile || !outFile) {
  console.error("用法: node tools/crop_png.mjs <输入.png> <输出.png> [阈值]");
  process.exit(1);
}
const THRESH = Number(thrArg || 26);

function decode(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let p = 8;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString("ascii", p + 4, p + 8);
    if (type === "IDAT") idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4 + 1;
  /* 反滤波（Chrome 输出通常已滤波，必须还原） */
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(w * 4);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * stride];
    const line = raw.subarray(y * stride + 1, y * stride + 1 + w * 4);
    const cur = Buffer.alloc(w * 4);
    for (let x = 0; x < w * 4; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const bb = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[x] = v & 0xff;
    }
    cur.copy(px, y * w * 4);
    prev = cur;
  }
  return { w, h, px };
}

function encode(w, h, px) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    px.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = buf => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const im = decode(inFile);
/* 逐列统计非背景像素。
   注意：只统计图像上部 55% —— 底部导航栏横跨全宽，
   若把它算进来，每一列都会被判为"有内容"，左右永远裁不掉。 */
const yLimit = Math.floor(im.h * 0.55);
const cols = new Array(im.w).fill(0);
for (let y = 0; y < yLimit; y += 2) {
  for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * 4;
    if (Math.max(im.px[i], im.px[i + 1], im.px[i + 2]) > THRESH) cols[x]++;
  }
}
let L = 0, R = im.w - 1;
while (L < im.w && cols[L] < 3) L++;
while (R > 0 && cols[R] < 3) R--;
/* 上下也裁掉多余留白 */
const rows = new Array(im.h).fill(0);
for (let y = 0; y < im.h; y++) {
  for (let x = L; x <= R; x += 2) {
    const i = (y * im.w + x) * 4;
    if (Math.max(im.px[i], im.px[i + 1], im.px[i + 2]) > THRESH) rows[y]++;
  }
}
let T = 0, B = im.h - 1;
while (T < im.h && rows[T] < 3) T++;
while (B > 0 && rows[B] < 3) B--;

const cw = R - L + 1, ch = B - T + 1;
const out = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) {
  im.px.copy(out, y * cw * 4, ((T + y) * im.w + L) * 4, ((T + y) * im.w + L + cw) * 4);
}
fs.writeFileSync(outFile, encode(cw, ch, out));
console.log(`  ${inFile} ${im.w}x${im.h}  ->  ${outFile} ${cw}x${ch}  (裁掉 左${L} 右${im.w - 1 - R} 上${T} 下${im.h - 1 - B})`);
