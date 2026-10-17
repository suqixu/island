// South continues the final flight; east meets its uphill edge. The west
// summit retains its lighthouse alone.
export const REST_PAVILION_SITES = Object.freeze([
  Object.freeze({
    id: 'south',
    position: Object.freeze({ x: 14.31, z: 19.37581097767837 }),
    entranceDirection: Object.freeze({ x: -1, z: 0 }),
    approach: Object.freeze({ x: 13.1800242437722, y: 35.82504653930664, z: 19.37581097767837 }),
    floorSize: 2,
    reservedRadius: 2.82,
  }),
  Object.freeze({
    id: 'east',
    position: Object.freeze({ x: 13.8703125, z: -23.5078125 }),
    entranceDirection: Object.freeze({ x: -.710118909508269, z: .7040817668131928 }),
    approach: Object.freeze({ x: 12.4, y: 45.4498405456543, z: -22.05 }),
    floorSize: 2,
    entryLanding: true,
    reservedRadius: 2.82,
  }),
]);

/** Reserve each roof and its narrow approach for planting and lamp placement. */
export function isRestPavilionReserved(x, z, padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const margin = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return REST_PAVILION_SITES.some(site => {
    const centre = site.position;
    if (Math.hypot(x - centre.x, z - centre.z) <= site.reservedRadius + margin) return true;
    const end = site.approach, dx = end.x - centre.x, dz = end.z - centre.z;
    const squared = dx * dx + dz * dz;
    const along = Math.max(0, Math.min(1, ((x - centre.x) * dx + (z - centre.z) * dz) / squared));
    return Math.hypot(x - centre.x - dx * along, z - centre.z - dz * along) <= .54 + margin;
  });
}
