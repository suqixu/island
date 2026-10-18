import { getSnowCover, isSnowLandscape } from './snow-surface.js';

export function canInsectsFly(env, activity) {
  const season = env.seasonIndex ?? ['spring', 'summer', 'autumn', 'winter'].indexOf(env.season ?? 'summer');
  return (season === 0 || season === 1) && (env.daylight ?? 1) > activity.minDaylight
    && (env.rain ?? 0) < activity.maxRain && !isSnowLandscape(env) && getSnowCover(env) === 0 && (env.storm ?? 0) < .1
    && (env.windSpeed ?? (2 + (env.wind ?? .3) * 20)) < activity.maxWindSpeed;
}
