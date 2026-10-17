export const LIGHTHOUSE_MUSIC_IDS = ['lighthouse', 'lighthouseLubinghua', 'lighthouseHualian', 'lighthouseTuogao'];
const exclusiveTracks = new Set([...LIGHTHOUSE_MUSIC_IDS, 'islandSong', 'dock', 'cave', 'caveDream', 'caveBoru', 'southPavilion', 'eastPavilion', 'caveChant']);
export const isExclusiveMusicTrack = id => exclusiveTracks.has(id);

export function getMusicSceneEffects(status, { enabled = false, paused = false } = {}) {
  const active = enabled && !paused;
  return {
    artificialLightsOff: Boolean(active && status?.id === 'caveChant' && ['playing', 'buffering'].includes(status.state)),
    poetrySuppressed: Boolean(active && exclusiveTracks.has(status?.id) && ['playing', 'buffering'].includes(status.state)),
  };
}
