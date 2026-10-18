/** 用 Chrome 复现原运行时的高质量缩放与 alpha 提取，输出无头部的 512² R8。 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(root, 'src/assets/textures/water/ocean-foam-lace-v1.webp');
const target = resolve(root, 'src/assets/textures/water/ocean-foam-mask-v1.bin');
const args = process.argv.slice(2), moduleFlag = args.indexOf('--playwright-module');
if (args.includes('--help')) {
  console.log('node scripts/assets/bake-ocean-foam.mjs [--check] [--playwright-module /path/to/playwright/index.mjs]');
  process.exit(0);
}
const { chromium } = await import(moduleFlag < 0 ? 'playwright' : pathToFileURL(resolve(args[moduleFlag + 1])).href);
const sourceBytes = await readFile(source);
const server = createServer((request, response) => {
  if (request.url === '/source.webp') {
    response.writeHead(200, { 'Content-Type': 'image/webp' }); response.end(sourceBytes);
  } else if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>泡沫遮罩离线烘焙</title>');
  } else { response.writeHead(404); response.end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const encoded = await page.evaluate(async () => {
    const response = await fetch('/source.webp');
    if (!response.ok) throw new Error('泡沫源图读取失败');
    const size = 512;
    const bitmap = await createImageBitmap(await response.blob(), {
      resizeWidth: size, resizeHeight: size, resizeQuality: 'high',
      premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(size, size);
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, size, size);
      const rgba = context.getImageData(0, 0, size, size).data;
      const mask = new Uint8Array(size * size);
      for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3];
      let binary = '';
      for (let i = 0; i < mask.length; i += 8192) binary += String.fromCharCode(...mask.subarray(i, i + 8192));
      return btoa(binary);
    } finally { bitmap.close(); canvas.width = canvas.height = 1; }
  });
  const mask = Buffer.from(encoded, 'base64');
  if (mask.length !== 512 * 512) throw new Error(`遮罩长度异常：${mask.length}`);
  if (args.includes('--check')) {
    const published = await readFile(target);
    if (!mask.equals(published)) throw new Error('预烘焙遮罩与当前 Chrome 原运行时流程不逐字节一致');
  } else await writeFile(target, mask);
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  console.log(JSON.stringify({
    mode: args.includes('--check') ? 'check' : 'write', browser: await browser.version(),
    sourceBytes: sourceBytes.length, maskBytes: mask.length,
    sourceSha256: sha256(sourceBytes), maskSha256: sha256(mask),
    ...(args.includes('--check') ? { identicalBytes: mask.length, changedBytes: 0 } : {}),
  }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
