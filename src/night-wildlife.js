import {attachRuntimeOptions} from './runtime-options.js';
import * as THREE from 'three';
import config from './config/night-wildlife.json' with { type: 'json' };
import { getAnimationDelta } from './animation-time.js';
import { createWildlifeView } from './wildlife-visibility.js';
import { getSnowCover } from './snow-surface.js';
import { seededRandom } from './terrain.js';
import { createFireflyPoints, createMothMeshes } from './models/night-insects.js';

const TAU = Math.PI * 2;
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function isWarmSummerNight(env) {
  const profile = config.activity;
  const season = env.seasonIndex ?? ['spring', 'summer', 'autumn', 'winter'].indexOf(env.season ?? 'summer');
  const hour = Number.isFinite(env.hour) ? ((env.hour % 24) + 24) % 24 : undefined;
  const nightHour = hour === undefined || hour >= profile.nightStart || hour < profile.nightEnd;
  return season === 1 && nightHour && (env.daylight ?? (hour === undefined ? 1 : 0)) < profile.maxDaylight
    && (env.temperature ?? profile.defaultTemperature) >= profile.minTemperature
    && (env.rain ?? 0) < profile.maxRain && (env.storm ?? 0) < profile.maxStorm
    && (env.snow ?? 0) === 0 && getSnowCover(env) === 0 && env.weather !== 'blizzard'
    && (env.windSpeed ?? (2 + (env.wind ?? .3) * 20)) < profile.maxWindSpeed;
}

// 从有效林缘中保留少量空间分开的小群；不改写或重排调用方的落点。
function selectClusterHabitats(habitats, profile, random, previous = [], time = 0) {
  const available = habitats.filter(habitat => habitat.available());
  // 冬季或初始化时全部不可用，仍保留候选供天气恢复后渐入。
  const candidates = available.length ? available : habitats;
  if (!candidates.length) return [];
  const positions = candidates.map(habitat => habitat.sample(time, new THREE.Vector3()));
  const fresh = candidates.map((habitat, index) => previous.includes(habitat) ? -1 : index).filter(index => index >= 0);
  const starts = fresh.length ? fresh : candidates.map((_, index) => index);
  const selected = [starts[Math.floor(random() * starts.length)]];
  const separation = profile.minClusterDistance * profile.minClusterDistance;
  while (selected.length < profile.maxClusters && selected.length < candidates.length) {
    let best = -1, farthest = -1;
    for (let index = 0; index < candidates.length; index++) {
      if (selected.includes(index)) continue;
      let nearest = Infinity;
      for (const chosen of selected) {
        const dx = positions[index].x - positions[chosen].x, dz = positions[index].z - positions[chosen].z;
        nearest = Math.min(nearest, dx * dx + dz * dz);
      }
      if (nearest < separation) continue;
      const score = nearest * (.7 + random() * .6) * (previous.includes(candidates[index]) ? .6 : 1);
      if (score > farthest) { farthest = score; best = index; }
    }
    if (best < 0) break;
    selected.push(best);
  }
  return selected.map(index => candidates[index]);
}

/** 栖息地与灯都采样真实世界位置；每个场景持有自己的时钟、随机流和资源。 */
export function createNightWildlife(parent, { habitats = [], lamps = [], heightAt = () => 0, random = Math.random } = {}) {
  const group = new THREE.Group(); group.name = '夏夜林缘'; group.userData.nightWildlife = true; group.visible = false; parent.add(group);
  const fireflyRandom = seededRandom(random() * 4294967296), mothRandom = seededRandom(random() * 4294967296);
  const fireflyProfile = config.firefly, mothProfile = config.moth;
  let clusters = selectClusterHabitats(habitats, fireflyProfile, fireflyRandom).map(habitat => ({ habitat, phase: fireflyRandom() * TAU }));
  const fireflyCapacity = Math.min(fireflyProfile.counts.high, Math.min(habitats.length, fireflyProfile.maxClusters) * fireflyProfile.perHabitat);
  const mothCapacity = lamps.length ? mothProfile.counts.high : 0;
  const points = createFireflyPoints(fireflyCapacity, fireflyProfile), { body, wings, meshes } = createMothMeshes(mothCapacity);
  group.add(points, ...meshes);
  const between = (profile, source) => profile.min + source() * profile.range;
  const fireflies = Array.from({ length: fireflyCapacity }, () => {
    const angle = fireflyRandom() * TAU, radius = Math.sqrt(fireflyRandom()) * fireflyProfile.clusterRadius;
    return { clusterIndex: 0, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
      height: between(fireflyProfile.height, fireflyRandom), phase: fireflyRandom() * TAU,
      period: between(fireflyProfile.flashPeriod, fireflyRandom), drift: fireflyRandom() * TAU,
      delay: between(fireflyProfile.arrivalDelay, fireflyRandom), fadeSeconds: between(fireflyProfile.fadeSeconds, fireflyRandom),
      age: 0, visibility: 0, position: new THREE.Vector3(), brightness: 0 };
  });
  const duration = phase => between(mothProfile.seconds[phase], mothRandom);
  const moths = Array.from({ length: mothCapacity }, () => ({
    phase: 'waiting', age: 0, duration: duration('waiting'), lamp: null, visibility: 0, departureVisibility: 0,
    angle: mothRandom() * TAU, flutter: mothRandom() * TAU, radius: between(mothProfile.orbitRadius, mothRandom),
    size: between(mothProfile.size, mothRandom), yaw: 0, position: new THREE.Vector3(), from: new THREE.Vector3(), target: new THREE.Vector3(),
  }));
  const anchor = new THREE.Vector3(), cameraPosition = new THREE.Vector3(), dummy = new THREE.Object3D(), wing = new THREE.Object3D();
  const wingRotation = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  const view = createWildlifeView();
  let quality = 'high', fireflyLimit = fireflyCapacity, mothLimit = mothCapacity, previousTime, clock = 0, poseAge = Infinity, disposed = false;
  let lastNightKey, pendingNightKey, nightEpoch = 0, wasNightWindow = false;

  function assignClusters() {
    const counts = clusters.map(() => 0), weights = clusters.map(() => .5 + fireflyRandom());
    for (let index = 0; index < fireflies.length; index++) {
      let clusterIndex = index % clusters.length;
      if (index >= clusters.length * 3) {
        const total = weights.reduce((sum, weight, at) => sum + (counts[at] < fireflyProfile.perHabitat ? weight : 0), 0);
        let pick = fireflyRandom() * total;
        for (let at = 0; at < weights.length; at++) {
          if (counts[at] >= fireflyProfile.perHabitat) continue;
          clusterIndex = at; pick -= weights[at]; if (pick <= 0) break;
        }
      }
      const firefly = fireflies[index];
      firefly.clusterIndex = clusterIndex; firefly.age = 0; firefly.visibility = 0; firefly.brightness = 0;
      if (counts[clusterIndex] !== undefined) counts[clusterIndex]++;
    }
    fireflyLimit = Math.min(fireflyCapacity, clusters.length * fireflyProfile.perHabitat, fireflyProfile.counts[quality]);
    points.geometry.setDrawRange(0, fireflyLimit); poseAge = Infinity;
  }

  function prepareNight(time, env, eligible) {
    const hour = Number.isFinite(env.hour) ? THREE.MathUtils.euclideanModulo(env.hour, 24) : undefined;
    const inWindow = (env.daylight ?? 0) < config.activity.maxDaylight &&
      (hour === undefined || hour >= config.activity.nightStart || hour < config.activity.nightEnd);
    if (inWindow && !wasNightWindow) nightEpoch++; wasNightWindow = inWindow;
    const key = Number.isFinite(env.dayIndex) && hour !== undefined
      ? env.dayIndex - (hour < config.activity.nightEnd ? 1 : 0) : nightEpoch;
    if (eligible && key !== lastNightKey) pendingNightKey = key;
    if (eligible && pendingNightKey !== undefined && fireflies.every(firefly => firefly.visibility === 0)) {
      if (lastNightKey !== undefined) {
        const previous = clusters.map(cluster => cluster.habitat);
        clusters = selectClusterHabitats(habitats, fireflyProfile, fireflyRandom, previous, time)
          .map(habitat => ({ habitat, phase: fireflyRandom() * TAU }));
        assignClusters();
      }
      lastNightKey = pendingNightKey; pendingNightKey = undefined;
    }
    return eligible && pendingNightKey === undefined;
  }

  function aboveGround(point, clearance = .12) {
    const height = heightAt(point.x, point.z); if (Number.isFinite(height)) point.y = Math.max(point.y, height + clearance);
  }
  function clearMoth(moth) {
    moth.phase = 'waiting'; moth.age = 0; moth.duration = duration('waiting'); moth.visibility = 0; moth.lamp = null;
  }
  function transitionMoth(moth, phase) {
    moth.from.copy(moth.position); moth.phase = phase; moth.age = 0; moth.duration = duration(phase);
    if (phase === 'departing') {
      moth.departureVisibility = moth.visibility;
      const radius = between(mothProfile.travelRadius, mothRandom);
      moth.target.copy(moth.position).add(anchor.set(Math.cos(moth.angle + 1.5) * radius, .7, Math.sin(moth.angle + 1.5) * radius));
      aboveGround(moth.target, .3);
    }
  }
  function orbitTarget(moth, time) {
    moth.lamp.sample(time, moth.target);
    const angle = moth.angle + moth.age * 1.4;
    moth.target.x += Math.cos(angle) * moth.radius; moth.target.z += Math.sin(angle) * moth.radius;
    moth.target.y += Math.sin(clock * 2.4 + moth.flutter) * .2 - .12;
    aboveGround(moth.target, .3);
  }
  function beginMoth(moth, time, env) {
    const first = Math.floor(mothRandom() * lamps.length);
    for (let step = 0; step < lamps.length; step++) {
      const lamp = lamps[(first + step) % lamps.length]; if (!lamp.isLit(env)) continue;
      moth.lamp = lamp; moth.angle = mothRandom() * TAU; orbitTarget(moth, time);
      const radius = between(mothProfile.travelRadius, mothRandom);
      moth.position.copy(moth.target).add(anchor.set(Math.cos(moth.angle) * radius, .5, Math.sin(moth.angle) * radius));
      aboveGround(moth.position, .3); transitionMoth(moth, 'entering'); return;
    }
  }
  function advanceMoth(moth, dt, time, env, eligible) {
    moth.age += dt;
    if (moth.phase === 'waiting') {
      if (!eligible) { moth.age = 0; return; }
      if (moth.age >= moth.duration) beginMoth(moth, time, env);
      if (moth.phase === 'waiting') return;
    }
    if (moth.phase !== 'departing' && (!eligible || !moth.lamp.isLit(env))) transitionMoth(moth, 'departing');
    if (moth.age >= moth.duration) {
      if (moth.phase === 'entering') transitionMoth(moth, 'circling');
      else if (moth.phase === 'circling') transitionMoth(moth, 'departing');
      else { clearMoth(moth); return; }
    }
    const oldX = moth.position.x, oldZ = moth.position.z, progress = moth.age / moth.duration;
    if (moth.phase !== 'departing') {
      orbitTarget(moth, time); moth.position.copy(moth.target);
      // 两段弧线的接缝从上一段终点衔接，不能因重置盘绕角度瞬移。
      moth.position.lerp(moth.from, 1 - smooth(moth.age / (moth.phase === 'entering' ? moth.duration : .5)));
      moth.visibility = moth.phase === 'entering' ? smooth(moth.age / .65) : 1;
    } else {
      moth.position.lerpVectors(moth.from, moth.target, smooth(progress)); moth.position.y += Math.sin(progress * Math.PI) * .3;
      moth.visibility = moth.departureVisibility * (1 - smooth((progress - .55) / .45));
    }
    aboveGround(moth.position);
    const dx = moth.position.x - oldX, dz = moth.position.z - oldZ;
    if (Math.hypot(dx, dz) > .0001) {
      const yaw = Math.atan2(dx, dz), turn = Math.atan2(Math.sin(yaw - moth.yaw), Math.cos(yaw - moth.yaw));
      moth.yaw += turn * (1 - Math.exp(-dt * 10));
    }
  }
  function advanceFirefly(firefly, dt, time, eligible) {
    const cluster = clusters[firefly.clusterIndex], habitat = cluster?.habitat, available = eligible && !!habitat?.available();
    firefly.age = available ? firefly.age + dt : 0;
    const target = available && firefly.age > firefly.delay ? 1 : 0, step = dt / firefly.fadeSeconds;
    firefly.visibility = target ? Math.min(1, firefly.visibility + step) : Math.max(0, firefly.visibility - step);
    if (firefly.visibility === 0) { firefly.brightness = 0; return; }
    habitat.sample(time, firefly.position);
    firefly.position.x += firefly.x + Math.sin(clock * .36 + firefly.drift) * fireflyProfile.driftRadius;
    firefly.position.z += firefly.z + Math.cos(clock * .28 + firefly.drift) * fireflyProfile.driftRadius;
    firefly.position.y += firefly.height + Math.sin(clock * .72 + firefly.drift) * .14;
    aboveGround(firefly.position);
    const pulse = Math.pow(Math.max(0, Math.sin(clock * TAU / firefly.period + firefly.phase)), 5);
    const density = .45 + .55 * (.5 + .5 * Math.sin(clock * .26 + cluster.phase));
    firefly.brightness = pulse * density * smooth(firefly.visibility);
  }
  function writePoses(writeFireflies = true, writeMoths = true) {
    if (writeFireflies) {
      const position = points.geometry.getAttribute('position'), brightness = points.geometry.getAttribute('aBrightness');
      for (let index = 0; index < fireflyCapacity; index++) {
        const firefly = fireflies[index]; position.setXYZ(index, firefly.position.x, firefly.position.y, firefly.position.z);
        brightness.setX(index, index < fireflyLimit ? firefly.brightness : 0);
      }
      position.needsUpdate = true; brightness.needsUpdate = true;
    }
    if (writeMoths) {
      for (let index = 0; index < mothCapacity; index++) {
        const moth = moths[index]; dummy.position.copy(moth.position); dummy.rotation.set(0, moth.yaw, 0);
        dummy.scale.setScalar(index < mothLimit ? moth.size * moth.visibility : 0); dummy.updateMatrix(); body.setMatrixAt(index, dummy.matrix);
        const flap = .35 + Math.sin(clock * 52 + moth.flutter) * .7;
        for (let side = 0; side < 2; side++) {
          wingRotation.setFromAxisAngle(zAxis, (side === 0 ? -1 : 1) * flap);
          wing.position.copy(moth.position); wing.quaternion.copy(dummy.quaternion).multiply(wingRotation); wing.scale.copy(dummy.scale); wing.updateMatrix();
          wings[side].setMatrixAt(index, wing.matrix);
        }
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    }
    poseAge = 0;
  }
  function setQuality(value = 'high') {
    if (disposed) return;
    quality = Object.hasOwn(fireflyProfile.counts, value) ? value : 'high';
    fireflyLimit = Math.min(fireflyCapacity, clusters.length * fireflyProfile.perHabitat, fireflyProfile.counts[quality]); mothLimit = Math.min(mothCapacity, mothProfile.counts[quality]);
    for (let index = fireflyLimit; index < fireflyCapacity; index++) { fireflies[index].visibility = 0; fireflies[index].brightness = 0; fireflies[index].age = 0; }
    for (let index = mothLimit; index < mothCapacity; index++) clearMoth(moths[index]);
    points.geometry.setDrawRange(0, fireflyLimit); for (const mesh of meshes) mesh.count = mothLimit; poseAge = Infinity;
  }
  function update(time, env = {}, camera) {
    if (disposed) return;
    const now = Number.isFinite(time) ? time : (previousTime ?? 0), dt = previousTime === undefined ? 0 : getAnimationDelta(now - previousTime, .1, env);
    previousTime = now; clock += dt; poseAge += dt;
    if (env.quality && quality !== env.quality) setQuality(env.quality);
    const eligible = isWarmSummerNight(env), mothEligible = eligible && lamps.some(lamp => lamp.isLit(env));
    const fireflyEligible = prepareNight(now, env, eligible);
    view.update(camera);
    let firefliesActive = false, mothsActive = false, firefliesInView = false, mothsInView = false;
    for (let index = 0; index < fireflyLimit; index++) {
      const firefly = fireflies[index]; advanceFirefly(firefly, dt, now, fireflyEligible);
      if (firefly.visibility > 0) { firefliesActive = true; firefliesInView ||= view.intersects(firefly.position, .2); }
    }
    for (let index = 0; index < mothLimit; index++) {
      const moth = moths[index]; advanceMoth(moth, dt, now, env, mothEligible);
      if (moth.visibility > 0) { mothsActive = true; mothsInView ||= view.intersects(moth.position, .4); }
    }
    let distance = 0;
    if (camera && (habitats.length || lamps.length)) {
      camera.getWorldPosition(cameraPosition); distance = Infinity;
      for (const { habitat } of clusters) { habitat.sample(now, anchor); distance = Math.min(distance, cameraPosition.distanceToSquared(anchor)); }
      for (const site of lamps) { site.sample(now, anchor); distance = Math.min(distance, cameraPosition.distanceToSquared(anchor)); }
      distance = Math.sqrt(distance);
    }
    const wasVisible = group.visible, pointsWereVisible = points.visible, mothsWereVisible = body.visible;
    points.visible = firefliesActive && firefliesInView && distance < config.distance.hidden;
    for (const mesh of meshes) mesh.visible = mothsActive && mothsInView && distance < config.distance.hidden;
    group.visible = points.visible || body.visible;
    if (!group.visible) {
      if (wasVisible && !firefliesActive && !mothsActive) writePoses(pointsWereVisible, mothsWereVisible);
      return;
    }
    // 每个批次重入镜头时立即刷新，避免另一个可见批次的限频导致旧姿态闪现。
    const pointEntry = points.visible && !pointsWereVisible, mothEntry = body.visible && !mothsWereVisible;
    if (wasVisible && !pointEntry && !mothEntry && distance > config.distance.fullRate && poseAge < config.distance.updateSeconds) return;
    writePoses(points.visible, body.visible);
  }
  function dispose() {
    if (disposed) return; disposed = true;
    const geometries = new Set(), materials = new Set();
    for (const object of [points, ...meshes]) { if (object.isInstancedMesh) object.dispose(); geometries.add(object.geometry); materials.add(object.material); }
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
    group.removeFromParent(); group.clear();
  }
  // 仅供明确的观察镜头调用；普通漫游不预热，也不改变等待与天气规则。
  function prepareObservation(kind,time,env){
    if(disposed||!isWarmSummerNight(env)||kind==='moth'&&!lamps.some(lamp=>lamp.isLit(env)))return;
    const eligible=prepareNight(time,env,true);
    const ready=()=>kind==='moth'?moths.some(m=>m.visibility>.7&&m.phase==='circling'):fireflies.some(f=>f.visibility>.7&&f.brightness>.15);
    for(let step=0;step<300&&!ready();step++){
      clock+=.1;for(const firefly of fireflies)advanceFirefly(firefly,.1,time,eligible);
      for(const moth of moths)advanceMoth(moth,.1,time,env,true);
    }
    writePoses();
  }
  function getObservationTarget(kind,time=previousTime??0){
    if(disposed)return null;
    if(kind==='moth'){
      const resident=moths.find(m=>m.visibility>.7&&m.phase==='circling')??moths.find(m=>m.visibility>0);
      const lamp=resident?.lamp??lamps[0];if(!lamp)return null;
      const position=lamp.sample(time,new THREE.Vector3());return {position,quaternion:lamp.quaternion?.clone()};
    }
    const best=fireflies.reduce((a,b)=>b.brightness>a.brightness?b:a,{brightness:-1}),habitat=clusters[best.clusterIndex??0]?.habitat;
    if(!habitat?.available())return null;
    const position=habitat.sample(time,new THREE.Vector3()).add(new THREE.Vector3(0,.7,0)),outward=habitat.viewFrom?habitat.viewFrom.clone().sub(position).setY(0):position.clone().setY(0);
    return {position,outward};
  }
  assignClusters(); writePoses(); return attachRuntimeOptions({group,update,setQuality,dispose,prepareObservation,getObservationTarget},{firefly:{capacity:fireflyCapacity,counts:fireflyProfile.counts,batches:[{body:points}]},moth:{capacity:mothCapacity,counts:mothProfile.counts,batches:[{body,parts:wings.map(mesh=>({mesh}))}]}});
}
