import { DEFAULTS, WEATHER_CONFIG } from './runtime-config.js';
import { getMoonState, getMoonNightVisibility, LUNAR_CYCLE_DAYS } from './moon.js';
import { getWindState } from './wind.js';
import { getAnimationRate } from './animation-time.js';
import {getCloudMode} from './weather-controls.js';

export const SEASONS = WEATHER_CONFIG.seasons;
export const WEATHER = WEATHER_CONFIG.presets;
export function createSimulation(overrides = {}) {
  const { moonPhase, sceneRates, ...simulation } = DEFAULTS.simulation;
  return { ...simulation, snowCover:0, snowMeltDelay:0, weatherDuration: undefined,
    weatherSeasonIndex: overrides.seasonIndex ?? simulation.seasonIndex,
    lunarDay: LUNAR_CYCLE_DAYS * moonPhase,
    windSeed: Math.floor(Math.random() * 2147483647), ...overrides };
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
  if (state.running && state.autoMoon && !state.holdMoonClock) {
    state.lunarDay = getMoonState(state.lunarDay + scaled / state.dayDuration).moonAge;
  }
  if (state.running && state.autoSeason) {
    state.seasonProgress += scaled;
    const seasons = Math.floor(state.seasonProgress / state.seasonDuration);
    state.seasonIndex = (state.seasonIndex + seasons) % 4;
    state.seasonProgress %= state.seasonDuration;
  }
  if (state.autoWeather) {
    const automatic = WEATHER_CONFIG.automatic;
    const typhoonSeason = automatic.typhoonSeasonIndices.includes(state.seasonIndex);
    const forecast = automatic.forecasts[state.seasonIndex];
    const severeWeather=state.seasonIndex===3?'blizzard':typhoonSeason?'typhoon':null;
    const ordinaryProbability = 1 - (severeWeather==='blizzard'?automatic.blizzardProbability:automatic.typhoonProbability);
    const nextDuration = () => automatic.durationSeconds.min + random() * automatic.durationSeconds.range;
    const nextWeather = () => {
      const candidates = forecast.filter(weather => weather !== state.weather && weather !== 'typhoon' && weather !== 'blizzard');
      const canSelectSevere = severeWeather && state.weather !== severeWeather;
      const sample = random();
      // 夏秋台风、冬季暴风雪保持低概率，普通天气均匀抽取且不连续重复。
      state.weather = canSelectSevere && sample >= ordinaryProbability ? severeWeather
        : candidates[Math.min(candidates.length - 1, Math.floor(sample / (canSelectSevere ? ordinaryProbability : 1) * candidates.length))];
      state.weatherDuration = nextDuration();
      const cloudModes=WEATHER_CONFIG.cloudModes;
      state.cloudMode=state.weather==='cloudy'
        ? cloudModes[Math.min(cloudModes.length-1,Math.floor(random()*cloudModes.length))].value
        : DEFAULTS.simulation.cloudMode;
    };
    // Reconcile season changes, while letting manual selections last until
    // their next automatic change even when outside the season's candidates.
    if (state.weatherSeasonIndex !== state.seasonIndex) {
      state.weatherSeasonIndex = state.seasonIndex;
      if (!forecast.includes(state.weather)) { nextWeather(); state.weatherProgress = 0; }
    }
    if (state.running) {
      state.weatherDuration ??= nextDuration();
      state.weatherProgress += scaled;
      while (state.weatherProgress >= state.weatherDuration) {
        state.weatherProgress -= state.weatherDuration;
        nextWeather();
      }
    }
  }
  // 积雪使用实际播放时间，独立于昼夜/季节倍率；暂停时保持原状。
  if(state.running) {
    const dt=delta*animationRate, pack=WEATHER_CONFIG.snowpack;
    const snowfall=WEATHER[state.weather]?.snow??0;
    const rainfall=Math.max(0,Math.min(1,WEATHER[state.weather]?.rain??0));
    const phase=(state.windSeed??0)*.013+(state.elapsed-dt*.5)*.11;
    const accumulationVariation=.86+.28*(.5+.5*Math.sin(phase));
    const meltVariation=.86+.28*(.5+.5*Math.sin(phase+2.7));
    const cover=Number.isFinite(state.snowCover)?Math.max(0,Math.min(1,state.snowCover)):0;
    if(snowfall>0) {
      state.snowCover=Math.min(1,cover+dt*pack.accumulationPerSecond*snowfall*accumulationVariation
        *(state.weather==='blizzard'?pack.blizzardMultiplier:1));
      state.snowMeltDelay=pack.retentionSeconds;
    } else {
      // 雨水落到残雪便开始消融；无雨时仍保留停雪后的等待期。
      const delay=rainfall>0?0:Math.max(0,state.snowMeltDelay??0), melting=Math.max(0,dt-delay);
      state.snowMeltDelay=Math.max(0,delay-dt);
      state.snowCover=cover;
      if(cover>0&&melting>0) {
        const temperature=getEnvironment(state).temperature;
        const rate=pack.meltPerSecond*(1+Math.max(0,temperature)*pack.warmthMultiplier)
          *(1+rainfall*pack.rainMeltMultiplier);
        state.snowCover=Math.max(0,cover-melting*rate*meltVariation);
      }
    }
  }
  return state;
}
export function getEnvironment(state) {
  const elevation = Math.sin((state.hour - 6) / 24 * Math.PI * 2);
  const daylight = Math.max(0, Math.min(1, (elevation + .12) / .5));
  const weather = WEATHER[state.weather] || WEATHER.sunny;
  const cloudMode=getCloudMode(state.weather==='cloudy'?state.cloudMode:DEFAULTS.simulation.cloudMode);
  const cloudSettings=Number.isFinite(cloudMode.coverage)
    ? {cloudCoverTarget:cloudMode.coverage,cloudiness:cloudMode.cloudiness,fog:cloudMode.fog}:{};
  const temperatures = WEATHER_CONFIG.seasonTemperatures;
  const moonState = getMoonState(state.lunarDay);
  const moonVisibility = getMoonNightVisibility(daylight);
  // 为赏月保留固定的夜间可见轨迹；月相独立于这一展示轨迹。
  let moonAltitude = Math.sin((state.hour - 18) / 24 * Math.PI * 2) * Math.PI / 6;
  if (Math.abs(moonAltitude) < 1e-12) moonAltitude = 0;
  const moonAzimuth = Math.atan2(-.64, -.77) + Math.sin(state.hour / 24 * Math.PI * 2) * 25 * Math.PI / 180;
  const moon = [Math.sin(moonAzimuth) * Math.cos(moonAltitude), Math.sin(moonAltitude), Math.cos(moonAzimuth) * Math.cos(moonAltitude)];
  const moonLight = moonState.moonIllumination * Math.max(0, Math.min(1, moon[1] / .5)) * moonVisibility;
  const wind = getWindState(state.elapsed, weather.wind, state.windSeed);
  const typhoon = state.weather === 'typhoon' ? 1 : 0;
  const blizzard=state.weather==='blizzard'?1:0;
  if (typhoon || blizzard) {
    // 普通风场保持原有单位；台风和暴风雪提供强风及持续阵风。
    wind.windSpeed = 35 + wind.gust * 12 + wind.swell * 13;
    wind.wind = .9 + wind.gust * .1;
    wind.gust = .55 + wind.gust * .45;
  }
  return { ...weather, ...cloudSettings, cloudMode:cloudMode.value, ...wind, typhoon, blizzard, roughSea:Math.max(typhoon,blizzard*(.72+wind.gust*.22)),
    snowCover:state.snowCover??0, ...moonState, animationRate: getAnimationRate(state), dayIndex:state.dayIndex??0, hour: state.hour, daylight, moon, moonAltitude, moonVisibility, moonLight,
    season: SEASONS[state.seasonIndex], seasonIndex: state.seasonIndex,
    weather: state.weather, temperature: temperatures[state.seasonIndex] - (1 - daylight) * 5 - weather.rain * 4 - weather.snow * 12,
    sun: [Math.cos((state.hour - 6) / 24 * Math.PI * 2) * .7, elevation, .55] };
}
