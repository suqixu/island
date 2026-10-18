import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

test('JSON 新增曲目和文件经 Vite 打包后自动进入播放器，并使用打包后的资源地址', async () => {
  const temporary = new URL('../tmp/test-fixtures/', import.meta.url);
  await mkdir(temporary, {recursive:true});
  const root = await mkdtemp(join(temporary.pathname, 'island-music-config-'));
  try {
    const config = JSON.parse(await readFile(new URL('../src/config/music.json', import.meta.url), 'utf8'));
    config.tracks.push({ id: 'newSong', title: '新增曲目', file: 'new-song.mp3' });
    await mkdir(join(root, 'config'));
    await mkdir(join(root, 'assets/music'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'config/music.json'), JSON.stringify(config));
    await writeFile(join(root, 'audio-player.js'), await readFile(new URL('../src/audio-player.js', import.meta.url)));
    // 在引擎边界读取播放器传入的曲库；不创建浏览器音频设备或发起媒体请求。
    await writeFile(join(root, 'audio.js'), 'export const createAudio = options => options;');
    await writeFile(join(root, 'entry.js'), 'export const openAudio = () => import("./audio-player.js");');
    await Promise.all(config.tracks.map(({ file }, index) => writeFile(join(root, 'assets/music', file), `test recording ${index}`)));
    const result = await build({ configFile: false, root, base: './', logLevel: 'silent',
      build: { assetsInlineLimit: 0, minify: false,
        rollupOptions: { input: join(root, 'entry.js'), preserveEntrySignatures: 'strict' } } });
    const entry = result.output.find(item => item.type === 'chunk' && item.isEntry);
    assert.deepEqual(entry.imports, [], '入口只能动态加载音频模块');
    assert.equal(entry.dynamicImports.length, 1);
    assert.equal(result.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.mp3')).length, 13);
    const { openAudio } = await import(pathToFileURL(join(root, 'dist', entry.fileName)).href);
    const { createAudio } = await openAudio();
    const options = createAudio();
    assert.equal(options.backgroundTracks.newSong.title, '新增曲目');
    assert.match(options.backgroundTracks.newSong.url, /new-song-[^/]+\.mp3$/);
    assert.match(options.sunsetMusicUrl, /yuzhou-changwan-weather-[^/]+\.mp3$/);
    assert.equal(Object.hasOwn(options.backgroundTracks, 'sunset'), false);
    options.backgroundTracks.newSong.title = '播放器局部修改';
    assert.equal(createAudio().backgroundTracks.newSong.title, '新增曲目');
  } finally { await rm(root, { recursive: true, force: true }); }
});
