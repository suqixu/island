/** 灯塔近景才触发；距离与观察目标各留一段退出缓冲，免于镜头晃动反复切歌。 */
export function isLighthouseMusicNearby(cameraPosition, target, center, env = {}, wasNearby = false) {
  if (!Number.isFinite(env.daylight) || env.daylight > .1) return false;
  const cameraDistance = cameraPosition.distanceToSquared(center);
  const focusDistance = target.distanceToSquared(center);
  return Number.isFinite(cameraDistance) && Number.isFinite(focusDistance)
    && cameraDistance <= (wasNearby ? 55 : 42) ** 2
    && focusDistance <= (wasNearby ? 18 : 12) ** 2;
}
