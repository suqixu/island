import { caveToLocal, CAVE_LAYOUT } from './cave-layout.js';
import { heightAt as terrainHeight, shoreDistance, coastRadius } from './terrain.js';

export const TERRAIN_GRID = Object.freeze({ size: 310, divisions: 256, step: 310 / 256 });
export const PATH_LIFT = .038;
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const DEFAULT_CAVE = Object.freeze({ x: 31.874, z: 38.343 });
const caches = new WeakMap();

// This is the same a-b-d / b-c-d diagonal used by Three's PlaneGeometry.
function renderedSampler(heightAt) {
  const values = new Map(), step = TERRAIN_GRID.step;
  const vertex = (ix, iz) => {
    const key = iz * 257 + ix;
    if (!values.has(key)) values.set(key, heightAt(-155 + ix * step, -155 + iz * step));
    return values.get(key);
  };
  return (x, z) => {
    const gx = clamp((x + 155) / step, 0, 256), gz = clamp((z + 155) / step, 0, 256);
    const ix = Math.min(255, Math.floor(gx)), iz = Math.min(255, Math.floor(gz));
    const u = gx - ix, v = gz - iz;
    return u + v <= 1 ? vertex(ix, iz) * (1 - u - v) + vertex(ix + 1, iz) * u + vertex(ix, iz + 1) * v
      : vertex(ix + 1, iz + 1) * (u + v - 1) + vertex(ix, iz + 1) * (1 - u) + vertex(ix + 1, iz) * (1 - v);
  };
}

function subdivide(points, height, closed = false) {
  const result = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], count = Math.max(1, Math.ceil(distance(a, b) / .65));
    if (i === 1) result.push({ x: a.x, y: height(a.x, a.z) + PATH_LIFT, z: a.z });
    for (let j = 1; j <= count; j++) {
      const x = a.x + (b.x - a.x) * j / count, z = a.z + (b.z - a.z) * j / count;
      result.push({ x, y: height(x, z) + PATH_LIFT, z });
    }
  }
  if (closed) result[result.length - 1] = { ...result[0] };
  return result;
}

function coastalLoop(height) {
  const controls = [];
  for (let index = 0; index <= 360; index++) {
    const angle = index / 360 * TAU;
    const inset = 9.1 + Math.sin(angle * 2 + .4) * .6 + Math.sin(angle * 5 + .8) * .3;
    const radius = (coastRadius(angle) - inset) / Math.hypot(Math.cos(angle) * 1.025, Math.sin(angle) * .975);
    controls.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  }
  return { id: 'coastal-loop', kind: 'coastal', width: 2.2, closed: true, points: subdivide(controls, height, true) };
}

// Stable offline-planned switchbacks; runtime only conforms the local mesh.
const WALKING_CONTROLS = {"mountain-ascent":[[0.0,66.201751414],[-0.939701475,60.806965762],[-1.148524025,59.608124506],[-2.95,53.15],[7.25,43.8],[8.25289375,40.19950625],[7.323725812,36.437898187],[5.50314375,33.02125625],[3,31.05],[2.15,28.5],[1.3,27.65],[2.15,24.25],[1.3,22.55],[2.15,20],[8.1,16.6],[8.95,19.15],[11.339335039,19.386451625],[13.3203125,19.375]],"cave-approach":[[8.25289375,40.19950625],[12.417978923,41.446716177],[18.543800488,41.675439413],[24.984491016,42.105592084],[33.748170285,40.685212857],[32.557275351,38.759094695],[31.874,38.343]],"ridge-west":[[2.15,20],[0.195,23.3575],[-2.95,22.55],[-2.1,20.85],[-1.25,18.3],[-3.8,20],[-2.969846978,14.854246217],[-1.726440091,10.345351525],[-0.4,6.4],[0.45,4.7],[0.24950625,3.81175],[-0.226711562,2.5607625],[-0.4,0.45],[-2.1,0.45],[-6.35,3],[-4.65,-2.1],[-3.8,-8.9],[-2.1,-14],[-5.5,-12.3],[-8.05,-15.7],[-8.9,-16.55],[-9.75,-16.55],[-15.7,-13.15],[-14.85,-11.45],[-11.45,-9.75],[-15.7,-6.35],[-16.55,-8.05],[-16.652796875,-7.711195313],[-16.953125,-8.3546875]],"ridge-east":[[-3.8,-8.9],[-3.9487755,-5.556073438],[-3.43127,-3.89190625],[-1.384898562,-7.182878105],[0.45,-10.6],[3,-12.3],[8.1,-10.6],[11.5,-10.6],[12.920775,-10.029225],[14.05,-9.75],[17.45,-14],[20.85,-16.55],[20.85,-20.8],[20,-22.5],[16.6,-24.2],[14.9,-18.25],[12.35,-19.1],[11.5,-19.95],[13.2,-21.65],[12.35,-21.65]],"beach-descent":[[-0.939701475,60.806965762],[-16.272949682,68.651968546],[-16.367212262,70.251991173],[-16.186474841,71.885003958],[-15.730737421,73.551006901],[-15,75.25]]};

function keyPoint(point) { return `${point.x.toFixed(6)},${point.z.toFixed(6)}`; }

function curvedControls(controls, anchors, height) {
  const points = controls.map(([x, z]) => ({ x, z })), result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    if (anchors.has(keyPoint(b))) { result.push(b); continue; }
    const inset = Math.min(1.2, distance(a, b) * .28, distance(b, c) * .28);
    const first = { x: b.x + (a.x - b.x) * inset / distance(a, b), z: b.z + (a.z - b.z) * inset / distance(a, b) };
    const last = { x: b.x + (c.x - b.x) * inset / distance(b, c), z: b.z + (c.z - b.z) * inset / distance(b, c) };
    result.push(first);
    for (let j = 1; j <= 8; j++) {
      const t = j / 8, u = 1 - t;
      result.push({ x: first.x * u * u + b.x * 2 * u * t + last.x * t * t,
        z: first.z * u * u + b.z * 2 * u * t + last.z * t * t });
    }
  }
  result.push(points.at(-1));
  return subdivide(result, height);
}

function meshWeights(x, z) {
  const step = TERRAIN_GRID.step, gx = clamp((x + 155) / step, 0, 256), gz = clamp((z + 155) / step, 0, 256);
  const ix = Math.min(255, Math.floor(gx)), iz = Math.min(255, Math.floor(gz)), u = gx - ix, v = gz - iz;
  const id = iz * 257 + ix;
  return u + v <= 1 ? [[id, 1 - u - v], [id + 1, u], [id + 257, v]]
    : [[id + 258, u + v - 1], [id + 257, 1 - u], [id + 1, 1 - v]];
}

function meshCuts(a, b) {
  const cuts = [0, 1], grid = TERRAIN_GRID.step;
  for (const [first, last, origin] of [[a.x, b.x, -155], [a.z, b.z, -155], [a.x + a.z, b.x + b.z, -310]]) {
    if (Math.abs(last - first) < 1e-10) continue;
    const low = Math.min(first, last), high = Math.max(first, last);
    for (let k = Math.floor((low - origin) / grid) + 1; origin + k * grid < high - 1e-9; k++) cuts.push((origin + k * grid - first) / (last - first));
  }
  return cuts.sort((a, b) => a - b).filter((value, index, all) => !index || value - all[index - 1] > 1e-9);
}

function benchedTerrain(heightAt, rawHeight, routes, summits, anchors) {
  const grid = TERRAIN_GRID.step, original = new Map(), values = new Map(), protectedVertices = new Set();
  const vertexPoint = id => ({ x: -155 + id % 257 * grid, z: -155 + Math.floor(id / 257) * grid });
  const rawVertex = id => {
    if (!original.has(id)) { const p = vertexPoint(id), value = heightAt(p.x, p.z); if (!Number.isFinite(value)) throw new Error('地形高度必须有限'); original.set(id, value); }
    return original.get(id);
  };
  const get = id => values.has(id) ? values.get(id) : rawVertex(id);
  const isProtected = id => {
    if (protectedVertices.has(id)) return true;
    const p = vertexPoint(id), local = caveToLocal(p);
    if (shoreDistance(p.x, p.z) < 6 || (Math.abs(local.side) <= 5.2 && local.forward >= -CAVE_LAYOUT.depth - .8 && local.forward <= 3.2)) {
      protectedVertices.add(id); return true;
    }
    return false;
  };
  for (const top of summits) for (const [id, weight] of meshWeights(top.x, top.z)) if (weight > .999999) protectedVertices.add(id);
  const nodes = new Map(), profileRoutes = [], segments = [];
  for (const route of routes.filter(route => route.kind !== 'coastal')) {
    const points = route.points.map(p => {
      const key = keyPoint(p); if (!nodes.has(key)) nodes.set(key, { ...p, y: rawHeight(p.x, p.z), fixed: anchors.has(key) });
      return nodes.get(key);
    });
    profileRoutes.push(points);
  }
  // Project the longitudinal profile while keeping real summits and junctions.
  for (let pass = 0; pass < 160; pass++) {
    let error = 0;
    for (const points of profileRoutes) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], limit = .55 * distance(a, b), diff = b.y - a.y;
      if (Math.abs(diff) <= limit) continue;
      const excess = diff - Math.sign(diff) * limit; error = Math.max(error, Math.abs(excess));
      if (!a.fixed && !b.fixed) { a.y += excess * .5; b.y -= excess * .5; }
      else if (!a.fixed) a.y += excess; else if (!b.fixed) b.y -= excess;
    }
    if (error < .00001) break;
  }
  for (const points of profileRoutes) for (let i = 1; i < points.length; i++) segments.push({ a: points[i - 1], b: points[i] });
  const candidates = new Map(), radius = 3.1;
  for (let index = 0; index < segments.length; index++) {
    const { a, b } = segments[index];
    for (let iz = Math.floor((Math.min(a.z, b.z) - radius + 155) / grid); iz <= Math.ceil((Math.max(a.z, b.z) + radius + 155) / grid); iz++) {
      for (let ix = Math.floor((Math.min(a.x, b.x) - radius + 155) / grid); ix <= Math.ceil((Math.max(a.x, b.x) + radius + 155) / grid); ix++) {
        const id = iz * 257 + ix; if (!candidates.has(id)) candidates.set(id, []); candidates.get(id).push(index);
      }
    }
  }
  for (const [id, ids] of candidates) {
    if (isProtected(id)) continue;
    const p = vertexPoint(id); let closest = Infinity, target = 0;
    for (const index of ids) {
      const { a, b } = segments[index], dx = b.x - a.x, dz = b.z - a.z, squared = dx * dx + dz * dz;
      const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / squared, 0, 1), gap = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
      if (gap < closest) { closest = gap; target = a.y + (b.y - a.y) * t; }
    }
    if (closest >= radius) continue;
    const t = clamp((closest - .75) / (radius - .75), 0, 1), weight = 1 - t * t * (3 - 2 * t), raw = rawVertex(id);
    values.set(id, raw + clamp((target - raw) * weight, -2, 2));
  }
  const constraints = [];
  for (const route of routes) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], span = distance(a, b), cuts = meshCuts(a, b);
    for (let j = 1; j < cuts.length; j++) {
      const first = cuts[j - 1], last = cuts[j], run = span * (last - first); if (run < 1e-7) continue;
      const terms = new Map();
      for (const [amount, sign] of [[first, -1], [last, 1]]) for (const [id, weight] of meshWeights(a.x + (b.x - a.x) * amount, a.z + (b.z - a.z) * amount)) terms.set(id, (terms.get(id) || 0) + sign * weight);
      constraints.push({ terms: [...terms].filter(([, value]) => Math.abs(value) > 1e-12), run,
        cap: route.forceSteps ? .60 : .28, hardCap: route.forceSteps ? .65 : .30 });
    }
  }
  const anchorConstraints = [];
  for (const point of nodes.values()) if (point.fixed) anchorConstraints.push({ terms: meshWeights(point.x, point.z), target: rawHeight(point.x, point.z) });
  const project = (terms, excess) => {
    const norm = terms.reduce((sum, [id, weight]) => sum + (isProtected(id) ? 0 : weight * weight), 0);
    if (norm < 1e-16) return;
    for (const [id, weight] of terms) if (!isProtected(id)) { const raw = rawVertex(id); values.set(id, clamp(get(id) - excess * weight / norm, raw - 2, raw + 2)); }
  };
  let maximumGrade = Infinity;
  for (let pass = 0; pass < 800; pass++) {
    for (const { terms, run, cap } of constraints) {
      const diff = terms.reduce((sum, [id, weight]) => sum + get(id) * weight, 0), limit = cap * run;
      if (Math.abs(diff) > limit) project(terms, diff - Math.sign(diff) * limit);
    }
    for (const { terms, target } of anchorConstraints) project(terms, terms.reduce((sum, [id, weight]) => sum + get(id) * weight, 0) - target);
    if (pass % 10 === 9) {
      maximumGrade = Math.max(...constraints.map(({ terms, run }) => Math.abs(terms.reduce((sum, [id, weight]) => sum + get(id) * weight, 0)) / run));
      const capError = Math.max(...constraints.map(({ terms, run, cap }) => Math.abs(terms.reduce((sum, [id, weight]) => sum + get(id) * weight, 0)) / run - cap));
      const anchorError = Math.max(...anchorConstraints.map(({ terms, target }) => Math.abs(terms.reduce((sum, [id, weight]) => sum + get(id) * weight, 0) - target)));
      if (capError < .001 && anchorError < .00001) break;
    }
  }
  if (constraints.some(({ terms, run, hardCap }) => Math.abs(terms.reduce((sum, [id, weight]) => sum + get(id) * weight, 0)) / run > hardCap + .000001)) {
    throw new Error(`沿路局部土方仍不能满足可走坡度: ${maximumGrade.toFixed(3)}`);
  }
  let maxCut = 0, maxFill = 0, affected = 0;
  for (const [id, value] of values) { const change = value - rawVertex(id); maxCut = Math.max(maxCut, -change); maxFill = Math.max(maxFill, change); if (Math.abs(change) > .001) affected++; }
  const sample = renderedSampler((x, z) => get(Math.round((z + 155) / grid) * 257 + Math.round((x + 155) / grid)));
  return { sample, stats: { maxCut, maxFill, affectedArea: affected * grid * grid, maximumGrade } };
}


function summitAt(id, centre, height) {
  const step = TERRAIN_GRID.step; let summit = { id, ...centre, y: height(centre.x, centre.z) };
  for (let iz = Math.floor((centre.z - 5 + 155) / step); iz <= Math.ceil((centre.z + 5 + 155) / step); iz++) {
    for (let ix = Math.floor((centre.x - 5 + 155) / step); ix <= Math.ceil((centre.x + 5 + 155) / step); ix++) {
      const x = -155 + ix * step, z = -155 + iz * step;
      if (Math.hypot(x - centre.x, z - centre.z) <= 5) {
        const y = height(x, z); if (y > summit.y) summit = { id, x, y, z };
      }
    }
  }
  return summit;
}

function mountainRoute(id, kind, points, { forceSteps = kind === 'mountain' || kind === 'cave' } = {}) {
  const stepSegments = [];
  for (let index = 1; index < points.length; index++) {
    const grade = Math.abs(points[index].y - points[index - 1].y) / distance(points[index], points[index - 1]);
    if (grade > (forceSteps ? .08 : .45)) stepSegments.push({ index, grade });
  }
  return { id, kind, width: kind === 'mountain' ? 1.1 : 1.2, closed: false, points, stepSegments, ...(forceSteps ? { forceSteps: true } : {}) };
}

function nearestPoint(route, target) {
  let result = route.points[0], best = Infinity;
  for (const point of route.points) { const value = distance(point, target); if (value < best) { best = value; result = point; } }
  return { x: result.x, z: result.z };
}

function spatialDistance(routes) {
  const size = 8, buckets = new Map(), segments = [], bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const route of routes) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dz = b.z - a.z, squared = dx * dx + dz * dz;
    if (squared < 1e-12) continue;
    const radius = route.width / 2, index = segments.length;
    segments.push({ x: a.x, z: a.z, dx, dz, squared, radius });
    const left = Math.floor((Math.min(a.x, b.x) - radius) / size), right = Math.floor((Math.max(a.x, b.x) + radius) / size);
    const bottom = Math.floor((Math.min(a.z, b.z) - radius) / size), top = Math.floor((Math.max(a.z, b.z) + radius) / size);
    bounds.minX = Math.min(bounds.minX, left); bounds.maxX = Math.max(bounds.maxX, right);
    bounds.minZ = Math.min(bounds.minZ, bottom); bounds.maxZ = Math.max(bounds.maxZ, top);
    for (let iz = bottom; iz <= top; iz++) for (let ix = left; ix <= right; ix++) {
      const key = `${ix},${iz}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(index);
    }
  }
  const visited = new Uint32Array(segments.length); let epoch = 0;
  const segmentDistance = (segment, x, z) => {
    const along = clamp(((x - segment.x) * segment.dx + (z - segment.z) * segment.dz) / segment.squared, 0, 1);
    return Math.hypot(x - segment.x - segment.dx * along, z - segment.z - segment.dz * along) - segment.radius;
  };
  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
    const cx = Math.floor(x / size), cz = Math.floor(z / size); let nearest = Infinity;
    if (cx < bounds.minX || cx > bounds.maxX || cz < bounds.minZ || cz > bounds.maxZ) {
      for (const segment of segments) nearest = Math.min(nearest, segmentDistance(segment, x, z));
      return nearest;
    }
    epoch = (epoch + 1) >>> 0; if (epoch === 0) { visited.fill(0); epoch = 1; }
    const cell = (ix, iz) => {
      const ids = buckets.get(`${ix},${iz}`); if (!ids) return;
      for (const index of ids) if (visited[index] !== epoch) { visited[index] = epoch; nearest = Math.min(nearest, segmentDistance(segments[index], x, z)); }
    };
    const limit = Math.max(cx - bounds.minX, bounds.maxX - cx, cz - bounds.minZ, bounds.maxZ - cz);
    for (let ring = 0; ring <= limit; ring++) {
      if (ring === 0) cell(cx, cz);
      else {
        for (let ix = cx - ring; ix <= cx + ring; ix++) { cell(ix, cz - ring); cell(ix, cz + ring); }
        for (let iz = cz - ring + 1; iz < cz + ring; iz++) { cell(cx - ring, iz); cell(cx + ring, iz); }
      }
      const boundary = Math.min(x - (cx - ring) * size, (cx + ring + 1) * size - x,
        z - (cz - ring) * size, (cz + ring + 1) * size - z);
      if (nearest <= boundary) break;
    }
    return nearest;
  };
}

/** A network is built once per height field / cave entrance, before planting. */
export function getIslandPathLayout({ heightAt = terrainHeight, caveEndpoint = DEFAULT_CAVE } = {}) {
  const cave = { x: Number.isFinite(caveEndpoint?.x) ? caveEndpoint.x : DEFAULT_CAVE.x,
    z: Number.isFinite(caveEndpoint?.z) ? caveEndpoint.z : DEFAULT_CAVE.z };
  if (!caches.has(heightAt)) caches.set(heightAt, new Map());
  const cache = caches.get(heightAt), key = `${cave.x},${cave.z}`;
  if (cache.has(key)) return cache.get(key);
  const rawHeightAtRendered = renderedSampler(heightAt), ring = coastalLoop(rawHeightAtRendered);
  const start = nearestPoint(ring, { x: 0, z: 66 });
  const summits = [summitAt('south', { x: 11, z: 19 }, rawHeightAtRendered), summitAt('west', { x: -17, z: -9 }, rawHeightAtRendered), summitAt('east', { x: 16, z: -22 }, rawHeightAtRendered)];
  const controls = Object.fromEntries(Object.entries(WALKING_CONTROLS).map(([id, points]) => [id, points.map(point => [...point])]));
  controls['mountain-ascent'][0] = [start.x, start.z]; controls['cave-approach'][controls['cave-approach'].length - 1] = [cave.x, cave.z];
  const anchors = new Set([...Object.values(controls).flatMap(points => [points[0], points.at(-1)]).map(([x,z]) => keyPoint({x,z})),...ring.points.map(keyPoint)]); const groundAnchors=new Set([keyPoint(start),...Object.values(controls).map(points=>keyPoint({x:points.at(-1)[0],z:points.at(-1)[1]})),...ring.points.map(keyPoint)]);
  const rawRoutes = [ring, { id: 'dock-link', kind: 'coastal', width: 2.2, closed: false, points: subdivide([{ x: 0, z: 64.5 }, start], rawHeightAtRendered) }];
  for (const [id, points] of Object.entries(controls)) rawRoutes.push(mountainRoute(id, id === 'cave-approach' ? 'cave' : id === 'beach-descent' ? 'beach' : 'mountain', curvedControls(points, anchors, rawHeightAtRendered), { forceSteps: true }));
  const terrain = benchedTerrain(heightAt, rawHeightAtRendered, rawRoutes, summits, groundAnchors), heightAtRendered = terrain.sample;
  const routes = rawRoutes.map(route => {
    const points = route.points.map(p => ({ ...p, y: heightAtRendered(p.x, p.z) + PATH_LIFT }));
    return route.kind === 'coastal' ? { ...route, points } : mountainRoute(route.id, route.kind, points, { forceSteps: true });
  });
  const landings = summits.map(top => { const route = routes.find(route => route.id === ({ south: 'mountain-ascent', west: 'ridge-west', east: 'ridge-east' })[top.id]), p = route.points.at(-1); return { id: top.id, x: p.x, z: p.z, y: heightAtRendered(p.x, p.z) }; });
  const layout = { routes, heightAtRendered, rawHeightAtRendered, distanceAt: spatialDistance(routes), summits, landings, viewpoints: landings.map(point => ({ ...point })), terrainStats: terrain.stats };
  cache.set(key, layout); return layout;
}

/** Signed distance in metres to the road edge: <=0 is inside the reserved path. */
export function pathDistanceAt(x, z, layout = getIslandPathLayout()) { return layout.distanceAt(x, z); }
