import { MathUtils, Vector3 } from 'three';

// Keep a band of sky in the dedicated moon view. A screen-anchored disc
// would otherwise fall behind the opaque ocean during a steep downward orbit.
export const MOON_VIEW_POLAR_LIMITS = Object.freeze({ min: Math.PI * .45, max: Math.PI * .55 });

/**
 * 月亮水平方向跟随镜头，垂直方向从海平线随模拟月高缓缓升落。
 * 不传环境状态时保留原构图，用于独立尺寸测量。
 */
export function getMoonBackdropDirection(camera, viewportWidth, env) {
  const mobile = viewportWidth < 760;
  const x = mobile ? .38 : .24;
  let y = mobile ? .46 : .52;
  const verticalSlope = Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) * .5);
  const forward = camera.getWorldDirection(new Vector3());
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  if (Number.isFinite(env?.moonAltitude) && Math.abs(up.y) > .001) {
    // 求出同一水平构图位置的真实海平线；月升时从海面开始显露月盘。
    const horizon = -(forward.y + right.y * x * verticalSlope * camera.aspect) / (up.y * verticalSlope);
    const height = viewportWidth / camera.aspect;
    const radius = getMoonBackdropSize(viewportWidth, height, env.moonPhase) / height;
    const peak = Math.max(horizon, Math.min(.9 - radius * 1.25, Math.max(y, horizon + .42)));
    const elevation = MathUtils.clamp(Math.sin(env.moonAltitude) / .5, -1, 1);
    y = horizon + (peak - horizon) * elevation;
  }
  if(env?.moonFraming==='complete'){const height=viewportWidth/camera.aspect,radius=(env.moonDiscSize||getMoonBackdropSize(viewportWidth,height,env.moonPhase))/height;y=MathUtils.clamp(y,-.72+radius,.72-radius);}
  return forward
    .addScaledVector(right, x * verticalSlope * camera.aspect)
    .addScaledVector(up, y * verticalSlope)
    .normalize();
}

function moonSizeState(viewportWidth, viewportHeight, moonPhase) {
  const phase = Number.isFinite(moonPhase) ? moonPhase : .5;
  const illumination = (1 - Math.cos(phase * Math.PI * 2)) * .5;
  return {
    natural: MathUtils.clamp(Math.min(viewportWidth * .06, viewportHeight * .04), 22, 36),
    full: Math.min(viewportWidth * .2, viewportHeight * .15),
    fullBlend: MathUtils.smoothstep(illumination, .99, .9995),
  };
}

/** 普通月相与太阳同尺度；仅在极窄满月窗口内平滑放大。 */
export function getMoonBackdropSize(viewportWidth, viewportHeight, moonPhase = .5) {
  const { natural, full, fullBlend } = moonSizeState(viewportWidth, viewportHeight, moonPhase);
  return MathUtils.lerp(natural, full, fullBlend);
}

/** 普通月相补偿离轴投影，满月仍严格保留原大月面的世界尺寸。 */
export function getMoonBackdropScale(camera, viewportWidth, viewportHeight, moonPhase = .5, moonDirection, discSize = 0) {
  const { natural, full, fullBlend } = moonSizeState(viewportWidth, viewportHeight, moonPhase);
  const direction = moonDirection?.isVector3
    ? moonDirection.clone().normalize() : getMoonBackdropDirection(camera, viewportWidth);
  const depthRatio = MathUtils.clamp(direction.dot(camera.getWorldDirection(new Vector3())), 0, 1);
  const pixels = discSize>0?discSize*depthRatio:MathUtils.lerp(natural * depthRatio, full, fullBlend);
  const verticalSlope = Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) * .5);
  return pixels * 3800 * verticalSlope / viewportHeight;
}
