import { hash, shoreDistance, smooth, TAU } from './terrain.js';

// A world-space patch field, independent of both the coastline contours and
// the scene's sequential random stream. Jittered, rotated ellipses leave broad
// gaps between small colonies instead of trimming a uniform grass ribbon.
function colonyAt(x, z, distance) {
  const spacing = 10, cellX = Math.floor(x / spacing), cellZ = Math.floor(z / spacing);
  let cover = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = cellX + dx, cz = cellZ + dz;
    const centerX = (cx + .15 + hash(cx + 81, cz - 24) * .7) * spacing;
    const centerZ = (cz + .15 + hash(cx - 39, cz + 62) * .7) * spacing;
    const angle = hash(cx + 17, cz + 91) * TAU;
    const px = x - centerX, pz = z - centerZ;
    const u = px * Math.cos(angle) + pz * Math.sin(angle);
    const v = -px * Math.sin(angle) + pz * Math.cos(angle);
    const spread = smooth(11.5, 14.5, distance) * (1 + smooth(18, 24, distance) * 3);
    const radiusX = (3.1 + hash(cx + 37, cz - 51) * 1.8) * spread;
    const radiusZ = (1.7 + hash(cx - 53, cz + 14) * 1.7) * spread;
    if (radiusX === 0 || radiusZ === 0) continue;
    const radius = Math.hypot(u / radiusX, v / radiusZ);
    cover = Math.max(cover, 1 - smooth(.7, 1.1, radius));
  }
  return cover;
}

export function beachGrassPlacement(point) {
  const distance = shoreDistance(point.x, point.z);
  if (distance >= 24) return point;
  if (distance < 11.5 || colonyAt(point.x, point.z, distance) < .2) return null;
  const inland = smooth(18, 24, distance);
  const vary = (dx, dz) => hash(point.x + dx, point.z + dz);
  const size = (amount) => point.scale * (amount + (1 - amount) * inland);
  return { ...point,
    scaleX: size(.62 + vary(71, 16) * .4),
    scaleY: size(.24 + vary(-31, 28) * .13),
    scaleZ: size(.58 + vary(45, -79) * .42),
    angle: point.angle + (vary(-24, -18) - .5) * .9 * (1 - inland),
  };
}

export function isOpenBeach(point) {
  // Leave a small margin for the root offsets used by the two plant meshes.
  return point.y < 5.45 && shoreDistance(point.x, point.z) < 20;
}
