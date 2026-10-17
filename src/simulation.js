import { getMoonState, getMoonNightVisibility, LUNAR_CYCLE_DAYS } from './moon.js';
import { getWindState } from './wind.js';
import { getAnimationRate } from './animation-time.js';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const WEATHER = {
  sunny:  { cloudiness: .12, rain: 0, snow: 0, fog: 0, storm: 0, wind: .22 },
  cloudy: { cloudiness: .86, rain: 0, snow: 0, fog: .1, storm: 0, wind: .38 },
  rain:   { cloudiness: .92, rain: .75, snow: 0, fog: .24, storm: 0, wind: .58 },
  fog:    { cloudiness: .52, rain: 0, snow: 0, fog: .9, storm: 0, wind: .12 },
  storm:  { cloudiness: 1, rain: 1, snow: 0, fog: .35, storm: 1, wind: .95 },
  snow:   { cloudiness: .76, rain: 0, snow: 1, fog: .25, storm: 0, wind: .36 },
};
export function createSimulation(overrides = {}) {
  return { hour: 14.5, dayIndex: 0, holdSunClock: false, elapsed: 0, running: true, speed: .5, dayDuration: 360,
    seasonIndex: 1, seasonProgress: 0, seasonDuration: 240, autoSeason: true,
    weather: 'sunny', autoWeather: true, weatherProgress: 0, weatherDuration: undefined,
    weatherSeasonIndex: overrides.seasonIndex ?? 1,
    lunarDay: LUNAR_CYCLE_DAYS / 2, autoMoon: true, windSeed: Math.floor(Math.random() * 2147483647), ...overrides };
}

/** 末联消隐后用真实时间收束月夜，保留用户选择的昼夜倍率。 */
export function finishMoonNight(state) {
  if (state.hour >= 6 && state.hour < 18 || state.moonNightEnding) return false;
  state.moonNightEnding = { startHour: state.hour, targetHour: state.hour < 6 ? 6.5 : 30.5, elapsed: 0 };
  return true;
}

export function advanceSimulation(state, delta, random = Math.random) {
  delta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const animationRate = getAnimationRate(state);
  state.elapsed += delta * animationRate;
  const scaled = state.running ? delta * state.speed : 0;
  if (state.running && !state.holdSunClock && state.moonNightEnding) {
    const ending = state.moonNightEnding;
    ending.elapsed += delta * animationRate;
    const progress = Math.min(1, ending.elapsed / 12);
    const eased = progress * progress * (3 - 2 * progress);
    const hour=ending.startHour + (ending.targetHour - ending.startHour) * eased;
    const dayOffset=Math.floor(hour/24);
    state.dayIndex=(state.dayIndex??0)+dayOffset-(ending.dayOffset??0);ending.dayOffset=dayOffset;
    state.hour = hour % 24;
    if (progress === 1) state.moonNightEnding = null;
  } else if (state.running && !state.holdSunClock) {
    const hour=state.hour+scaled*24/state.dayDuration;
    state.dayIndex=(state.dayIndex??0)+Math.floor(hour/24);state.hour=((hour%24)+24)%24;
  }
  if (state.running && state.autoMoon) {
    state.lunarDay = getMoonState(state.lunarDay + scaled / state.dayDuration).moonAge;
  }
  if (state.running && state.autoSeason) {
    state.seasonProgress += scaled;
    const seasons = Math.floor(state.seasonProgress / state.seasonDuration);
    state.seasonIndex = (state.seasonIndex + seasons) % 4;
    state.seasonProgress %= state.seasonDuration;
  }
  if (state.autoWeather) {
    const forecast = state.seasonIndex === 3
      ? ['sunny', 'cloudy', 'rain', 'fog', 'snow']
      : ['sunny', 'cloudy', 'rain', 'fog', 'storm'];
    const nextWeather = () => {
      const candidates = forecast.filter(weather => weather !== state.weather);
      state.weather = candidates[Math.floor(random() * candidates.length)];
      state.weatherDuration = 35 + random() * 50;
    };
    // Reconcile season changes, while letting manual selections last until
    // their next automatic change even when outside the season's candidates.
    if (state.weatherSeasonIndex !== state.seasonIndex) {
      state.weatherSeasonIndex = state.seasonIndex;
      if (!forecast.includes(state.weather)) { nextWeather(); state.weatherProgress = 0; }
    }
    if (state.running) {
      state.weatherDuration ??= 35 + random() * 50;
      state.weatherProgress += scaled;
      while (state.weatherProgress >= state.weatherDuration) {
        state.weatherProgress -= state.weatherDuration;
        nextWeather();
      }
    }
  }
  return state;
}
export function getEnvironment(state) {
  const elevation = Math.sin((state.hour - 6) / 24 * Math.PI * 2);
  const daylight = Math.max(0, Math.min(1, (elevation + .12) / .5));
  const weather = WEATHER[state.weather] || WEATHER.sunny;
  const temperatures = [23, 29, 21, 8];
  const moonState = getMoonState(state.lunarDay);
  const moonVisibility = getMoonNightVisibility(daylight);
  // 为赏月保留固定的夜间可见轨迹；月相独立于这一展示轨迹。
  let moonAltitude = Math.sin((state.hour - 18) / 24 * Math.PI * 2) * Math.PI / 6;
  if (Math.abs(moonAltitude) < 1e-12) moonAltitude = 0;
  const moonAzimuth = Math.atan2(-.64, -.77) + Math.sin(state.hour / 24 * Math.PI * 2) * 25 * Math.PI / 180;
  const moon = [Math.sin(moonAzimuth) * Math.cos(moonAltitude), Math.sin(moonAltitude), Math.cos(moonAzimuth) * Math.cos(moonAltitude)];
  const moonLight = moonState.moonIllumination * Math.max(0, Math.min(1, moon[1] / .5)) * moonVisibility;
  const wind = getWindState(state.elapsed, weather.wind, state.windSeed);
  return { ...weather, ...wind, ...moonState, animationRate: getAnimationRate(state), dayIndex:state.dayIndex??0, hour: state.hour, daylight, moon, moonAltitude, moonVisibility, moonLight,
    season: SEASONS[state.seasonIndex], seasonIndex: state.seasonIndex,
    weather: state.weather, temperature: temperatures[state.seasonIndex] - (1 - daylight) * 5 - weather.rain * 4 - weather.snow * 12,
    sun: [Math.cos((state.hour - 6) / 24 * Math.PI * 2) * .7, elevation, .55] };
}
