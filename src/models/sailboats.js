import {attachRuntimeOptions} from '../runtime-options.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSunsetSailboatMotion } from '../sunset-sailboat-motion.js';
import {loadSailboatSurfaces,disposeSailboatSurfaceMaps} from '../sailboat-surfaces.js';
import {heightAt as terrainHeight} from '../terrain.js';

function merged(parts) {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

function beam(a, b, radius) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 5);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  return geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

function hullGeometry(widthScale = 1, endRise = 0) {
  const positions = [], uvs=[], indices = [], stations = [[-5, .28], [-4.3, .8], [-2.5, 1.2], [0, 1.3], [3.1, 1.08], [4.5, .49], [5, .025]];
  for (const [z, halfWidth] of stations) {
    const width = halfWidth * widthScale, deck = .85 + endRise * Math.pow(Math.abs(z) / 5, 3);
    positions.push(-width, deck, z, width, deck, z, width * .28, -.55, z, -width * .28, -.55, z);
    // Grain follows the keel; the cross-section wraps planks around hull/deck.
    for(const across of [0,.5,.75,1])uvs.push(z*.28,across);
  }
  for (let station = 0; station < stations.length - 1; station++) for (let side = 0; side < 4; side++) {
    const a = station * 4 + side, b = station * 4 + (side + 1) % 4;
    indices.push(a, b, b + 4, a, b + 4, a + 4);
  }
  indices.push(0, 1, 2, 0, 2, 3, 24, 26, 25, 24, 27, 26);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

function sailGeometry(polygons) {
  const positions = [],uvs=[];
  for (const points of polygons) {
    const centre = [points[0][0] + .30, points.reduce((sum, point) => sum + point[1], 0) / points.length,
      points.reduce((sum, point) => sum + point[2], 0) / points.length];
    for (let i = 0; i < points.length; i++)for(const point of [points[i],points[(i+1)%points.length],centre]){
      positions.push(...point);uvs.push(point[2]*.38,point[1]*.38);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

function silhouetteModels() {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const sloopMast = v(0, 13, -.4), foreMast = v(0, 13, .7), aftMast = v(0, 10.8, -2.4), fishingMast = v(0, 6.2, 1.65);
  const ribs = [];
  for (const y of [4.5, 7, 9.6]) ribs.push(beam(v(.28, y, .8), v(.28, y, 4.5), .024));
  for (const y of [4.2, 6.6, 8.8]) ribs.push(beam(v(.28, y, -2.4), v(.28, y, -4.5), .024));
  const models = [
    { style: 'sloop', name: '单桅小帆艇', parts: [
      { name: '窄壳尖艏小艇', geometry: hullGeometry() },
      { name: '单高桅与帆桁', geometry: merged([
        beam(v(0, .7, -.4), sloopMast, .07), beam(v(0, 2.05, -.4), v(0, 2.5, -4.65), .042),
        beam(v(0, .9, 3.8), v(0, 1.05, 5.35), .04),
      ]) },
      { name: '单桅三角帆', cloth: true, geometry: sailGeometry([
        [[.04, 2.05, -.4], [.04, 12.8, -.4], [.04, 2.5, -4.65]],
        [[-.04, 2.05, .15], [-.04, 11.65, .15], [-.04, 1.55, 4.65]],
      ]) },
      { name: '小艇细索', rope: true, geometry: merged([
        beam(sloopMast, v(0, .95, -4.7), .016), beam(sloopMast, v(0, 1.05, 5.35), .016),
        beam(sloopMast, v(-1.15, .85, 0), .013), beam(sloopMast, v(1.15, .85, 0), .013),
      ]) },
    ] },
    { style: 'traditional', name: '传统双桅帆船', parts: [
      { name: '上扬艏艉传统船壳', geometry: hullGeometry(1.12, .42) },
      { name: '双桅横桁与帆骨', geometry: merged([
        beam(v(0, .7, .7), foreMast, .075), beam(v(0, .7, -2.4), aftMast, .065),
        beam(v(-1.65, 10.6, .7), v(1.65, 10.6, .7), .045),
        beam(v(-1.4, 8.7, -2.4), v(1.4, 8.7, -2.4), .04),
        beam(v(0, 2.15, .7), v(0, 2.15, 4.8), .045), beam(v(0, 2.15, -2.4), v(0, 2.15, -4.75), .04), ...ribs,
      ]) },
      { name: '传统双四边帆', cloth: true, geometry: sailGeometry([
        [[.05, 2.2, .7], [.05, 12.5, .7], [.05, 10.8, 3.8], [.05, 2.2, 4.75]],
        [[.05, 2.15, -2.4], [.05, 10.35, -2.4], [.05, 9.5, -4.0], [.05, 2.15, -4.7]],
      ]) },
      { name: '传统船细索', rope: true, geometry: merged([
        beam(foreMast, v(0, 1.2, 5), .016), beam(aftMast, v(0, 1.2, -5), .016),
        beam(foreMast, aftMast, .016),
      ]) },
    ] },
    { style: 'fishing', name: '短桅渔船', parts: [
      { name: '宽短渔船壳', geometry: hullGeometry(1.18, .08) },
      { name: '低矮渔船舱', geometry: merged([
        new THREE.BoxGeometry(1.85, 1.7, 2.5).translate(0, 1.65, -.9),
        new THREE.BoxGeometry(2.12, .22, 2.8).translate(0, 2.6, -.9),
      ]) },
      { name: '渔船短桅与小帆桁', geometry: merged([
        beam(v(0, .8, 1.65), fishingMast, .07), beam(v(0, 1.9, 1.65), v(0, 1.9, 4.3), .04),
        beam(v(-.75, 3.9, 1.65), v(.75, 3.9, 1.65), .035),
      ]) },
      { name: '渔船短桅小帆', cloth: true, geometry: sailGeometry([
        [[.04, 1.95, 1.65], [.04, 5.95, 1.65], [.04, 1.95, 4.25]],
      ]) },
      { name: '渔船细索', rope: true, geometry: merged([
        beam(fishingMast, v(0, .95, 4.8), .015), beam(fishingMast, v(0, 2.6, -1), .015),
      ]) },
    ] },
  ];
  for (const model of models) {
    model.bounds = new THREE.Box3();
    for (const part of model.parts) { part.geometry.computeBoundingBox(); model.bounds.union(part.geometry.boundingBox); }
    model.size = model.bounds.getSize(new THREE.Vector3());
    model.centre = model.bounds.getCenter(new THREE.Vector3());
  }
  return models;
}

/** Four slots with three shared silhouettes, allocated once and chosen per voyage. */
export function createSailboats(scene, { heightAt=terrainHeight, seed, loadSurfaces=loadSailboatSurfaces } = {}) {
  const group = new THREE.Group(); group.name = '远海帆船剪影'; scene.add(group);
  const motion = createSunsetSailboatMotion({ heightAt, seed });
  const models = silhouetteModels();
  const geometries = new Set(models.flatMap(model => model.parts.map(part => part.geometry))), materials = new Set();
  const dayHull = new THREE.Color('#26353b'), nightHull = new THREE.Color('#182635');
  const daySail = new THREE.Color('#efe3bf'), nightSail = new THREE.Color('#9babaf');
  const records = motion.boats.map(boat => {
    const ship = new THREE.Group(); ship.name = `远海帆船 ${boat.index + 1}`; ship.visible = false;
    ship.userData.opacity = 0; ship.userData.route = null; ship.userData.style = null; group.add(ship);
    // Motion already fades every silhouette with rain, storm and sea fog.
    // Avoid a second distance fog pass that erases even clear-weather sails.
    const timber = new THREE.MeshStandardMaterial({ color: dayHull, emissive:dayHull,emissiveIntensity:.35,roughness:.92,metalness:0,bumpScale:.025,transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,forceSinglePass:true, fog: false });
    const cloth = new THREE.MeshStandardMaterial({ color: daySail,emissive:daySail,emissiveIntensity:.35,roughness:.98,metalness:0,bumpScale:.007,transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,forceSinglePass:true, fog: false });
    materials.add(timber); materials.add(cloth);
    const variants = models.map(model => {
      const variant = new THREE.Group(); variant.name = model.name; variant.userData.style = model.style; variant.visible = false;
      for (const part of model.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.cloth ? cloth : timber); mesh.name = part.name; mesh.renderOrder = 2;
        mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.rope = Boolean(part.rope); variant.add(mesh);
      }
      ship.add(variant); return { model, variant };
    });
    return { boat, ship, timber, cloth, variants, lastRoute: null };
  });
  let disposed = false,activeMaps=null,pending;
  let filmFrame, filmRoute, filmKey;
  function sampleFilm(frame,context){
    if(!frame){if(!filmFrame)return;filmFrame=undefined;filmRoute=undefined;filmKey=undefined;for(const record of records)record.lastRoute=null;return;}
    filmFrame={...frame,camera:context.frameAt(frame.start)};
  }
  function planFilmVoyage(view,duration){
    const forward=view.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right=new THREE.Vector3(forward.z,0,-forward.x),eye=view.getWorldPosition(new THREE.Vector3());
    const course=right.clone().multiplyScalar(.75).addScaledVector(forward,.16);
    // Validate the whole hull corridor once, including bow and beam; never
    // move a render-only ship onto land just to fill a frame.
    for(const distance of [280,360,440,560])for(const side of [-.12,.12,-.3,.3]){
      const start=eye.clone().addScaledVector(forward,distance).addScaledVector(right,distance*side).setY(0);
      let safe=true;
      for(let time=0;time<=duration+2&&safe;time+=2)for(const x of [-13,0,13])for(const z of [-5,0,5]){
        const p=start.clone().addScaledVector(course,time).addScaledVector(right,x).addScaledVector(forward,z);
        const bed=heightAt?.(p.x,p.z);
        if(!Number.isFinite(bed)||bed>=-5||Math.hypot(p.x,p.z)<150)safe=false;
      }
      if(safe)return {style:'fishing',beam:6,length:22,height:12,start:0,duration,x:start.x,z:start.z,vx:course.x,vz:course.z,heading:Math.atan2(course.x,course.z)};
    }
    return null;
  }
  const surfaceController=new AbortController();
  function setSurfaceMaps(maps){
    if(disposed){disposeSailboatSurfaceMaps(maps);return;}
    const next=maps??{},retained=new Set(Object.values(next).flatMap(material=>Object.values(material??{})));
    disposeSailboatSurfaceMaps(activeMaps,retained);activeMaps=next;
    for(const record of records)for(const [kind,material]of [['wood',record.timber],['cloth',record.cloth]]){
      const map=next[kind]?.albedo??null,bump=next[kind]?.relief??null;
      const recompile=Boolean(material.map)!==Boolean(map)||Boolean(material.bumpMap)!==Boolean(bump);
      material.map=map;material.bumpMap=bump;if(recompile)material.needsUpdate=true;
    }
  }
  return attachRuntimeOptions({
    group,
    sampleFilm,
    setSurfaceMaps,
    // Optional close-up material inspection only; the main scene uses lit colors.
    loadSurfaces({signal,...options}={}){
      if(pending)return pending;
      if(disposed||signal?.aborted)return Promise.resolve(false);
      const abort=()=>surfaceController.abort();signal?.addEventListener('abort',abort,{once:true});
      pending=Promise.resolve(loadSurfaces({...options,signal:surfaceController.signal})).then(maps=>{
        if(disposed||surfaceController.signal.aborted){disposeSailboatSurfaceMaps(maps);return false;}
        setSurfaceMaps(maps);return Boolean(maps);
      }).catch(()=>false).finally(()=>signal?.removeEventListener('abort',abort));
      return pending;
    },
    update(elapsed, env = {}, camera) {
      if (disposed) return;
      if(filmFrame){
        const key=`${filmFrame.id}:${filmFrame.camera.aspect}`;
        if(filmKey!==key){filmRoute=planFilmVoyage(filmFrame.camera,filmFrame.end-filmFrame.start);filmKey=key;records[0].lastRoute=null;}
      }else motion.advance(elapsed, env, camera);
      const daylight = Number.isFinite(env?.daylight) ? Math.max(0, Math.min(1, env.daylight)) : 1;
      for (const record of records) {
        const { boat, ship, timber, cloth, variants } = record;
        const route=filmFrame?filmRoute:boat.route;
        const t=filmFrame?.localTime??0;
        const opacity=filmFrame?THREE.MathUtils.smoothstep(t,0,2)*(1-THREE.MathUtils.smoothstep(filmFrame.progress,.91,1)):0;
        const pose=filmFrame?{visible:boat.index===0&&Boolean(route),opacity,x:(route?.x??0)+(route?.vx??0)*t,z:(route?.z??0)+(route?.vz??0)*t,y:.12+Math.sin(t*1.1)*.08,heading:route?.heading??0,pitch:Math.sin(t*.7)*.012,roll:Math.sin(t*.83)*.025}:boat.pose;
        ship.visible = pose.visible;
        ship.userData.opacity = pose.opacity; ship.userData.route = route;
        if (route !== record.lastRoute) {
          // Motion assigns a new voyage only while this slot has zero opacity.
          // Normalize the complete selected model, including yards and cabin,
          // into exactly the dimensions checked by its world-space route.
          for (const { model, variant } of variants) {
            variant.visible = route?.style === model.style;
            if (!variant.visible) continue;
            variant.scale.set(route.beam / model.size.x, route.height / model.bounds.max.y, route.length / model.size.z);
            variant.position.set(-model.centre.x * variant.scale.x, 0, -model.centre.z * variant.scale.z);
          }
          ship.userData.style = route?.style ?? null; record.lastRoute = route;
        }
        if (!route) continue;
        ship.position.set(pose.x, pose.y, pose.z);
        ship.rotation.set(pose.pitch, pose.heading, pose.roll, 'YXZ');
        timber.opacity = pose.opacity * .96; cloth.opacity = pose.opacity * .96;
        timber.color.copy(nightHull).lerp(dayHull, daylight);
        cloth.color.copy(nightSail).lerp(daySail, daylight);
        timber.emissive.copy(timber.color);cloth.emissive.copy(cloth.color);
      }
    },
    setQuality(quality) {
      if (disposed) return;
      for (const { variants } of records) for (const { variant } of variants)
        for (const mesh of variant.children) if (mesh.userData.rope) mesh.visible = quality !== 'low';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      surfaceController.abort();disposeSailboatSurfaceMaps(activeMaps);activeMaps=null;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.removeFromParent(); group.clear();
    },
  },{sailboat:{capacity:records.length,objects:records.map(r=>r.ship)}});
}
