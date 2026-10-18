import { createAudio as createAudioEngine } from './audio.js';
import musicConfig from './config/music.json' with { type: 'json' };

// Vite 将曲库目录中的文件编入资源图；这里只解析 URL，不预先请求音频。
// 本模块仍由用户开启声音时动态导入。新增曲目只需添加文件和 JSON 条目。
const musicUrls = import.meta.glob('./assets/music/*.mp3', { eager: true, query: '?url', import: 'default' });

export function createAudio(options = {}) {
  const tracks = Object.fromEntries(musicConfig.tracks.map(({ id, title, file }) => {
    const url = musicUrls[`./assets/music/${file}`];
    if (!url) throw new Error(`音乐文件未找到：${file}`);
    return [id, { url, title }];
  }));
  const sunsetTrackId = musicConfig.playlists.sunset.trackId;
  const { [sunsetTrackId]: sunsetTrack, ...backgroundTracks } = tracks;
  return createAudioEngine({ sunsetMusicUrl: sunsetTrack?.url, backgroundTracks, ...options });
}
