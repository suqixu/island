/** 离线缩小雪花四宫格；保留源图，使用 libwebp 的透明度感知缩放及无损编码。 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourcePath = 'src/assets/textures/sky/snowflake-atlas-v1.webp';
const targetPath = 'src/assets/textures/sky/snowflake-atlas-runtime-512-v1.webp';
const metadataPath = 'prompts/textures/snowflake-atlas-runtime-v1.json';
const temporary = resolve(root, 'tmp/assets/snowflake-atlas');
const candidate = resolve(temporary, 'snowflake-atlas-runtime-512-v1.webp');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/assets/bake-snowflake-atlas.mjs [--check]；需要本机 cwebp 和 dwebp（libwebp）。');
  process.exit(0);
}
const execute = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败：${result.stderr}`);
  return result.stdout.trim();
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(temporary, { recursive: true });
const source = await readFile(resolve(root, sourcePath));
const encoder = execute('cwebp', ['-version']).split('\n')[0];
execute('cwebp', ['-quiet', '-resize', '512', '512', '-lossless', '-exact', '-m', '6', resolve(root, sourcePath), '-o', candidate]);

async function decode(path, name) {
  const pam = resolve(temporary, `${name}.pam`);
  execute('dwebp', [path, '-pam', '-o', pam]);
  const bytes = await readFile(pam), marker = Buffer.from('ENDHDR\n');
  const end = bytes.indexOf(marker);
  if (end < 0) throw new Error('解码结果缺少 PAM 头部');
  const header = bytes.toString('ascii', 0, end);
  const width = Number(header.match(/WIDTH (\d+)/)?.[1]), height = Number(header.match(/HEIGHT (\d+)/)?.[1]);
  const pixels = bytes.subarray(end + marker.length);
  if (!header.includes('DEPTH 4') || pixels.length !== width * height * 4) throw new Error('缩放必须保留完整 RGBA');
  const alpha = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    alpha[Number(y >= height / 2) * 2 + Number(x >= width / 2)] += pixels[(y * width + x) * 4 + 3];
  }
  return { width, height, quadrantAlphaCoverage: alpha.map(value => value / (width * height / 4 * 255)) };
}
const before = await decode(resolve(root, sourcePath), 'source');
const after = await decode(candidate, 'derived');
if (before.width !== 1024 || before.height !== 1024 || after.width !== 512 || after.height !== 512) throw new Error('源图或派生图尺寸不符');
const coverageChanges = after.quadrantAlphaCoverage.map((value, i) => value - before.quadrantAlphaCoverage[i]);
if (coverageChanges.some(value => Math.abs(value) > .0025)) throw new Error('缩放后的单格雪花透明度覆盖变化过大');
if (!source.equals(await readFile(resolve(root, sourcePath)))) throw new Error('离线流程不得修改源图');
const derived = await readFile(candidate);
const metadata = {
  source: { path: sourcePath, bytes: source.length, sha256: sha256(source), width: 1024, height: 1024,
    provenance: 'prompts/textures/snow-imagegen-v1.json；原 ImageGen 资产保持不变。' },
  derived: { path: targetPath, bytes: derived.length, sha256: sha256(derived), width: 512, height: 512, encoding: 'lossless WebP RGBA' },
  processing: {
    script: 'scripts/assets/bake-snowflake-atlas.mjs', encoder: `libwebp ${encoder}`,
    command: 'cwebp -quiet -resize 512 512 -lossless -exact -m 6 SOURCE -o TARGET',
    note: '仅数学等比缩放，不重绘；四宫格每格由512变为256像素。运行时保留mipmap，最大雪花仍为34屏幕像素。',
    quadrantAlphaCoverageBefore: before.quadrantAlphaCoverage,
    quadrantAlphaCoverageAfter: after.quadrantAlphaCoverage,
  },
};
if (args.includes('--check')) {
  const published = await readFile(resolve(root, targetPath));
  if (!published.equals(derived)) throw new Error('派生图与当前 libwebp 复现结果不逐字节一致');
  const publishedMetadata = JSON.parse(await readFile(resolve(root, metadataPath), 'utf8'));
  if (publishedMetadata.source.sha256 !== metadata.source.sha256 || publishedMetadata.derived.sha256 !== metadata.derived.sha256) throw new Error('来源记录的哈希与实际文件不符');
} else {
  await writeFile(resolve(root, targetPath), derived);
  await writeFile(resolve(root, metadataPath), `${JSON.stringify(metadata, null, 2)}\n`);
}
console.log(JSON.stringify({ mode: args.includes('--check') ? 'check' : 'write', ...metadata, quadrantAlphaCoverageChanges: coverageChanges }, null, 2));
