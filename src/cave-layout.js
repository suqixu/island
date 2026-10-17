// The southeast shoulder has enough rock above a horizontal passage while its
// approach meets the existing slope. Coordinates are shared with paths/cameras.
const length = Math.hypot(160, 200);
export const CAVE_LAYOUT = Object.freeze({
  entrance: Object.freeze({ x: 30, y: 9.9, z: 36 }),
  approach: Object.freeze({ x: 31.874, y: 9.78, z: 38.343 }),
  direction: Object.freeze({ x: 160 / length, y: 0, z: 200 / length }),
  width: 6.2,
  height: 5.2,
  depth: 18,
});

export function caveToWorld(side, height, forward) {
  const { entrance, direction } = CAVE_LAYOUT;
  return {
    x: entrance.x + side * direction.z + forward * direction.x,
    y: entrance.y + height,
    z: entrance.z - side * direction.x + forward * direction.z,
  };
}

export function caveToLocal(point) {
  const { entrance, direction } = CAVE_LAYOUT;
  const x = point.x - entrance.x, z = point.z - entrance.z;
  return {
    side: x * direction.z - z * direction.x,
    height: point.y - entrance.y,
    forward: x * direction.x + z * direction.z,
  };
}

export function isCaveReserved(x, z, margin = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const padding = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  const local = caveToLocal({ x, y: CAVE_LAYOUT.entrance.y, z });
  return Math.abs(local.side) <= 5.2 + padding
    // The deep winding passage is underground; keep the original surface clearing.
    && local.forward >= -8.5 - .8 - padding
    // A narrow clearing also keeps crowns between the entrance and its preset
    // camera out of the view; it does not remove the surrounding forest.
    && local.forward <= 24 + padding;
}

// A convex arch prism, slightly wider than the visible aperture. Triangle
// clipping catches coarse grid cells crossing its boundary, not just vertices.
const halfWidth = 3.35;
const aperture = [[-halfWidth, -.35], [halfWidth, -.35], [halfWidth, 2.8]];
for (let index = 1; index <= 12; index++) {
  const angle = index / 12 * Math.PI;
  aperture.push([Math.cos(angle) * halfWidth, 2.8 + Math.sin(angle) * 2.65]);
}

function clip(polygon, distance) {
  if (!polygon.length) return polygon;
  const result = [];
  let previous = polygon[polygon.length - 1], previousDistance = distance(previous);
  for (const current of polygon) {
    const currentDistance = distance(current);
    if ((previousDistance >= 0) !== (currentDistance >= 0)) {
      const t = previousDistance / (previousDistance - currentDistance);
      result.push({
        side: previous.side + (current.side - previous.side) * t,
        height: previous.height + (current.height - previous.height) * t,
        forward: previous.forward + (current.forward - previous.forward) * t,
      });
    }
    if (currentDistance >= 0) result.push(current);
    previous = current; previousDistance = currentDistance;
  }
  return result;
}

export function isCaveOpeningTriangle(a, b, c) {
  let polygon = [a, b, c].map(caveToLocal);
  if (polygon.some(point => !Object.values(point).every(Number.isFinite))) return false;
  if (polygon.every(point => point.side < -halfWidth) || polygon.every(point => point.side > halfWidth)
    || polygon.every(point => point.forward < -1.75) || polygon.every(point => point.forward > 1.75)
    || polygon.every(point => point.height < -.35) || polygon.every(point => point.height > 5.45)) return false;
  polygon = clip(polygon, point => point.forward + 1.75);
  polygon = clip(polygon, point => 1.75 - point.forward);
  for (let index = 0; polygon.length && index < aperture.length; index++) {
    const start = aperture[index], end = aperture[(index + 1) % aperture.length];
    polygon = clip(polygon, point => (end[0] - start[0]) * (point.height - start[1])
      - (end[1] - start[1]) * (point.side - start[0]));
  }
  return polygon.length >= 3;
}

// An open U section: left wall, curved roof, right wall. The floor is built
// separately, so no front-facing polygon can fake a dark cave entrance.
export function caveProfile(halfWidth = CAVE_LAYOUT.width / 2, roofHeight = CAVE_LAYOUT.height, phase = 0) {
  const spring = roofHeight * .5;
  const points = [[-halfWidth, 0], [-halfWidth, spring]];
  for (let index = 1; index <= 12; index++) {
    const angle = Math.PI - index / 12 * Math.PI;
    points.push([Math.cos(angle) * halfWidth, spring + Math.sin(angle) * (roofHeight - spring)]);
  }
  points.push([halfWidth, 0]);
  return points.map(([side, height], index) => [
    side + (Math.sin(index * 1.91 + phase + .3) * .095 + Math.cos(index * 3.07 + phase) * .035) * halfWidth / 3.1,
    height === 0 ? 0 : height + Math.sin(index * 2.37 + phase + .8) * .11,
  ]);
}
