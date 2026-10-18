// Only 16× accelerates scene motion. Keep accumulated time continuous when
// changing rates; the other rates retain their daylight/season behavior.
export const getAnimationRate = (state = {}) => Number.isFinite(state?.filmMotionRate)?Math.max(.25,Math.min(16,state.filmMotionRate)):state?.animationRate === 16 || state?.speed === 16 ? 16 : 1;

export function getAnimationDelta(delta, limit, environment) {
  return Number.isFinite(delta) ? Math.max(0, Math.min(delta, limit * getAnimationRate(environment))) : 0;
}
