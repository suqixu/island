/** 码头木板沿 z=65..101；观察目标需落在这一带，且已经拉到近景。 */
export function isDockMusicNearby(cameraPosition, target, wasNearby = false) {
  const z = Math.max(65, Math.min(101, target.z));
  const focusDistance = target.x ** 2 + (target.y - 2) ** 2 + (target.z - z) ** 2;
  const cameraDistance = cameraPosition.distanceToSquared(target);
  return Number.isFinite(focusDistance) && Number.isFinite(cameraDistance)
    && focusDistance <= (wasNearby ? 13 : 9) ** 2
    && cameraDistance <= (wasNearby ? 48 : 35) ** 2;
}
