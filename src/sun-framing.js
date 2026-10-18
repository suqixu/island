import { MathUtils, Matrix4, Vector2, Vector3, Vector4 } from 'three';

/** Screen metric shared by the solar disc, occulting moon and corona. */
export function getSunDiscProjection(camera,direction,angularRadius){
  camera.updateWorldMatrix(true,false);
  const matrix=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const clip=new Vector4(direction.x,direction.y,direction.z,0).applyMatrix4(matrix);
  const fallback=()=>({matrix,center:new Vector2(),radius:0,aspect:camera.aspect});
  const p=camera.projectionMatrix.elements,sine=Math.sin(angularRadius);
  // Reject discs beyond a side of the view or touching the camera plane:
  // dividing nearly-zero edge depths would invent an enormous screen radius.
  if(clip.w<=sine+1e-5
    ||clip.w+clip.x< -sine*Math.hypot(p[0],p[8]-1)
    ||clip.w-clip.x< -sine*Math.hypot(p[0],p[8]+1)
    ||clip.w+clip.y< -sine*Math.hypot(p[5],p[9]-1)
    ||clip.w-clip.y< -sine*Math.hypot(p[5],p[9]+1))return fallback();
  const center=new Vector2(clip.x/clip.w,clip.y/clip.w);
  const up=new Vector3().setFromMatrixColumn(camera.matrixWorld,1);
  up.addScaledVector(direction,-up.dot(direction)).normalize();
  const edge=sign=>{
    const ray=direction.clone().multiplyScalar(Math.cos(angularRadius)).addScaledVector(up,sign*Math.sin(angularRadius));
    const point=new Vector4(ray.x,ray.y,ray.z,0).applyMatrix4(matrix);
    return point.y/point.w;
  };
  return{matrix,center,radius:Math.abs(edge(1)-edge(-1))*.5,aspect:camera.aspect};
}

/**
 * 太阳的屏幕构图只改变方向，不改变真实升落或天气强度。
 * 天空不足时保留独立的物理方向；盘面跨越地平线时由天空着色器遮蔽。
 */
export function getSunBackdropState(camera, viewportWidth, viewportHeight, physicalDirection) {
  const physical = physicalDirection.clone().normalize();
  const verticalSlope = Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) * .5);
  const diameter = MathUtils.clamp(Math.min(viewportWidth * .06, viewportHeight * .04), 22, 36);
  const radius = diameter * .5;
  const fallback = () => ({
    direction: physical.clone(),
    framed: false,
    angularRadius: Math.atan(diameter * verticalSlope / Math.max(1, viewportHeight)),
  });
  if (!(viewportWidth > 0 && viewportHeight > 0 && verticalSlope > 0)) return fallback();

  // getWorldDirection 同时更新父节点及相机的世界矩阵。
  const forward = camera.getWorldDirection(new Vector3());
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const horizontal = new Vector3(forward.x, 0, forward.z);
  if (horizontal.lengthSq() < 1e-8 || up.y <= 1e-5) return fallback();
  horizontal.normalize();
  if (horizontal.dot(forward) <= 1e-5) return fallback();

  const cameraPosition = camera.getWorldPosition(new Vector3());
  const horizon = cameraPosition.clone().addScaledVector(horizontal, 1900).project(camera);
  const x = .36;
  // 滚转后地平线倾斜：从水平前向投影校正到太阳所在的 x。
  const horizonNdcY = horizon.y - right.y / up.y * camera.aspect * (x - horizon.x);
  const horizonPixels = (1 - horizonNdcY) * viewportHeight * .5;
  const mobile = viewportWidth < 760;
  const uiBottom = mobile ? 78 : viewportHeight > 780 ? 86 : 72;
  const minimumCenter = uiBottom + radius + 12;
  const maximumCenter = Math.min(horizonPixels, viewportHeight) - radius - 12;
  if (!Number.isFinite(horizonPixels) || maximumCenter < minimumCenter) return fallback();

  const preferredCenter = Math.max(mobile ? 110 : viewportHeight > 780 ? 122 : 104, viewportHeight * .15);
  const highCenter = MathUtils.clamp(preferredCenter, minimumCenter, maximumCenter);
  // 零高度时盘心准确落在地平线上，正高度平滑升到日间构图。
  // 负高度使用地平线投影的角度导数缓慢沉降，仍允许上缘露出。
  const horizonRayLength = Math.hypot(1, x * verticalSlope * camera.aspect, horizonNdcY * verticalSlope);
  const descentScale = viewportHeight * horizonRayLength / (2 * up.y * verticalSlope);
  const center = physical.y >= 0
    ? MathUtils.lerp(horizonPixels, highCenter, MathUtils.smoothstep(physical.y, 0, .25))
    : horizonPixels - physical.y * descentScale;
  const y = 1 - center * 2 / viewportHeight;
  const ray = ndcY => forward.clone()
    .addScaledVector(right, x * verticalSlope * camera.aspect)
    .addScaledVector(up, ndcY * verticalSlope)
    .normalize();
  const direction = ray(y);

  // 两条盘缘投影射线把像素直径换成球面角半径，修正右上离轴放大。
  const ndcRadius = diameter / viewportHeight;
  const angularRadius = (direction.angleTo(ray(y + ndcRadius)) + direction.angleTo(ray(y - ndcRadius))) * .5;
  return { direction, framed: true, angularRadius };
}

const unit = (value, fallback = 0) => MathUtils.clamp(Number.isFinite(value) ? value : fallback, 0, 1);

/** 太阳盘、天空日晕与海面反光共用真实高度和天气遮蔽。 */
export function getSunVisibility({ sunHeight, daylight = 1, cloudiness = 0, rain = 0, snow = 0, fog = 0, storm = 0 }) {
  const height = Number.isFinite(sunHeight) ? sunHeight : -1;
  const elevation = MathUtils.smoothstep(height, -.035, .06);
  // 晴天常用 .12 不遮盘；.88 的浓云完全遮盘，平方压低阴天余量。
  const cloudTransmission = 1 - MathUtils.smoothstep(unit(cloudiness), .12, .88);
  // 浓雾有更强的广域消光，雨、雪与雷暴分别压低直接光。
  const transmission = cloudTransmission ** 2 * (1 - unit(fog)) ** 3 *
    (1 - unit(rain)) ** 2 * (1 - unit(snow)) ** 2 * (1 - unit(storm)) ** 2;
  return elevation * MathUtils.smoothstep(unit(daylight, 1), .02, .2) * transmission;
}
