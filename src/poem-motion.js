export const POEM_CUE_DURATION = 10;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/** 每联的真实经过秒数；空诗和无效输入安全返回首联入口。 */
export function getPoemCue(elapsed, cueCount) {
  const count = Number.isFinite(cueCount) ? Math.floor(cueCount) : 0;
  if (count < 1) return { index: 0, age: 0 };
  const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  return {
    index: Math.floor(seconds / POEM_CUE_DURATION) % count,
    age: seconds % POEM_CUE_DURATION,
  };
}

/**
 * 世界空间字幕的逐字运动。位移以字高计，depth 正值表示远离镜头，rotation 为弧度。
 * variant 0 原处渐隐，1 随风向右上飞散，2 向两侧和海面散落。
 */
export function getGlyphMotion(age, column, row, variant = 0, reducedMotion = false, output) {
  const seconds = Number.isFinite(age) ? clamp(age, 0, POEM_CUE_DURATION) : 0;
  const glyph = Number.isFinite(column) ? clamp(Math.floor(column), 0, 32) : 0;
  const line = Number.isFinite(row) ? clamp(Math.floor(row), 0, 1) : 0;
  const mode = Number.isFinite(variant) ? Math.max(0, Math.floor(variant)) % 3 : 0;
  // 延迟上限让异常长行也在第三秒前完成进入，并在第十秒前消失。
  const delay = Math.min(1.5, glyph * .09 + line * .85);
  const entered = smoothstep((seconds - delay) / 1.05);
  const exitProgress = clamp((seconds - 7 - delay) / 1.2, 0, 1);
  const exited = smoothstep(exitProgress);
  // Hot-path callers may provide scratch storage; the default keeps the
  // original independent snapshot contract for other consumers.
  const result = output ?? {};
  result.opacity = entered * (1 - exited);
  result.drift = 0;
  result.lift = 0;
  result.depth = 0;
  result.rotation = 0;
  result.scale = 1;
  if (reducedMotion) return result;

  result.lift = entered < 1 ? -.5 * (1 - entered) : 0;
  if (exitProgress === 0) return result;

  if (mode === 0) {
    result.lift += .45 * exited;
    return result;
  }

  // 飞散从静止逐渐加速；阅读阶段位置保持完全稳定。
  const travel = exitProgress * exitProgress;
  if (mode === 1) {
    result.drift = (10 + (glyph % 3) * .45) * travel;
    result.lift += (7 + line * .4) * travel;
    result.depth = 8 * travel;
    result.rotation = (.16 + (glyph % 3) * .025) * travel;
    result.scale = 1 - .42 * exited;
  } else {
    const side = glyph % 2 === 0 ? -1 : 1;
    result.drift = side * (7.2 + (glyph % 3) * .35) * travel;
    result.lift -= (1.8 + line * .4) * travel;
    result.depth = 9 * travel;
    result.rotation = side * .13 * travel;
    result.scale = 1 - .5 * exited;
  }
  return result;
}
