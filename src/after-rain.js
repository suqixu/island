const MOISTURE_SECONDS = 120;
const RAINBOW_SECONDS = 90;
const CLEARING_SECONDS = 3;

const unit = (value, fallback = 0) => Number.isFinite(value)
  ? Math.max(0, Math.min(1, value)) : fallback;
const ease = value => {
  const amount = unit(value);
  return amount * amount * (3 - 2 * amount);
};

// 每个大气实例持有自己的水汽与彩虹记忆，时间使用累计真实秒。
export function createAfterRainState() {
  return { lastTime: 0, wetAt: null, clearSince: null, startedAt: null };
}

export function advanceAfterRain(state, time, env = {}) {
  const now = Number.isFinite(time) ? Math.max(state.lastTime, time, 0) : state.lastTime;
  state.lastTime = now;
  env ??= {};

  // 天气名称来自实际环境；过渡中的雨量残值不能凭空创建雨后事件。
  if (env.weather === 'rain' || env.weather === 'storm') {
    state.wetAt = now;
    state.clearSince = null;
    state.startedAt = null;
    return 0;
  }

  if (state.wetAt !== null && now - state.wetAt > MOISTURE_SECONDS) state.wetAt = null;
  if (state.startedAt !== null && now - state.startedAt >= RAINBOW_SECONDS) state.startedAt = null;

  const sunny = env.weather === 'sunny';
  if (sunny) state.clearSince ??= now;
  else state.clearSince = null;

  const rain = unit(env.rain), storm = unit(env.storm);
  const fog = unit(env.fog), snow = unit(env.snow);
  const visible = sunny && unit(env.daylight) > .3 && fog < .55 && snow <= .05;
  // 晴天已到时，最多容许三秒等待上一种天气的降水数值渐消。
  const cleared = rain <= .08 && storm <= .08
    || (state.clearSince !== null && now - state.clearSince >= CLEARING_SECONDS);

  if (state.wetAt !== null && state.startedAt === null && visible && cleared) {
    state.startedAt = now;
    state.wetAt = null;
  }
  if (state.startedAt === null || !visible || !cleared) return 0;

  const age = now - state.startedAt;
  // 前十二秒淡入，最后三十秒淡出；夜晚或遮蔽不会延长事件。
  const envelope = ease(age / 12) * ease((RAINBOW_SECONDS - age) / 30);
  const transmission = unit(env.sunVisibility, 1) * (1 - unit(env.cloudiness) * .45)
    * (1 - fog * .8) * (1 - rain * .75) * (1 - storm * .75);
  return unit(envelope * transmission);
}
