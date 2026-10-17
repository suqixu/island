import { CAVE_LAYOUT } from './cave-layout.js';

/** 洞口预设与洞内细节都在这一段，附近山坡及全岛视角不触发。 */
export function isCaveMusicNearby(cameraPosition, target, wasNearby = false) {
  const { entrance, direction, depth } = CAVE_LAYOUT;
  const x = target.x - entrance.x, z = target.z - entrance.z;
  const side = x * direction.z - z * direction.x;
  const forward = x * direction.x + z * direction.z;
  const height = target.y - entrance.y;
  const distance = cameraPosition.distanceToSquared(target);
  const margin = wasNearby ? 3 : 0;
  return Number.isFinite(distance) && Number.isFinite(side) && Number.isFinite(forward) && Number.isFinite(height)
    && Math.abs(side) <= 8 + margin && forward >= -depth - 3 - margin && forward <= 6 + margin
    && height >= -3 - margin && height <= 12 + margin
    && distance <= (wasNearby ? 40 : 28) ** 2;
}
