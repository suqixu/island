import { createPavilionMusicTrigger } from './pavilion-music-trigger.js';

const songs = {
  island: [[3, 'islandSongMusic']],
  cave: [[3, 'caveMusic'], [5, 'caveBoruMusic'], [10, 'caveDreamMusic'], [12, 'caveChantMusic']],
  dock: [[3, 'dockMusic']],
  lighthouse: [[3, 'lighthouseMusic'], [5, 'lighthouseLubinghuaMusic'], [10, 'lighthouseHualianMusic'], [12, 'lighthouseTuogaoMusic']],
};

/** 地标只在指定点击次数启动歌曲；同次停留不循环点击计数。 */
export function createLandmarkMusicTrigger(center, viewId) {
  const entries = songs[viewId];
  if (!entries) throw new RangeError('未知音乐地标');
  const trigger = createPavilionMusicTrigger(center, viewId, entries.map(([step]) => step), { repeat: false, maxCameraDistance: viewId === 'island' ? 500 : viewId === 'dock' ? 90 : 45 });
  return {
    ...trigger,
    getMusicFlags(camera, target, moving = false) {
      return Object.fromEntries(entries.map(([step, flag]) => [flag, trigger.isActive(camera, target, moving, step)]));
    },
  };
}
