import * as THREE from 'three';
import { sampleTyphoonBreaker } from './typhoon-waves.js';
import { createSprayAtlas } from './ocean-spray-texture.js';
import { createImpactPlumes } from './ocean-impact.js';

export function createOceanSpray(scene, { heightAt, shelterAt } = {}) {
  const capacity = 1600;
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const velocity = new Float32Array(capacity * 3);
  const ages = new Float32Array(capacity).fill(10);
  const lifetimes = new Float32Array(capacity);
  const kinds = new Float32Array(capacity);
  const seeds = new Float32Array(capacity);
  const baseSizes = new Float32Array(capacity);
  const sources = [];
  if (heightAt) for (let x = -180; x <= 180; x += 5) for (let z = -180; z <= 180; z += 5) {
    const h = heightAt(x, z);
    if (h > -.5 || h < -3.8) continue;
    const dx = heightAt(x + 2, z) - heightAt(x - 2, z);
    const dz = heightAt(x, z + 2) - heightAt(x, z - 2);
    const length = Math.hypot(dx, dz);
    if (length < .1) continue;
    sources.push({ x, z, depth: -h, nx: dx / length, nz: dz / length,
      exposure: 1 - THREE.MathUtils.clamp(shelterAt?.(x, z) ?? 0, 0, 1) * .72,
      credit: 0, previousImpact: 0, cooldown: 0 });
  }
  // 此处只创建共享纹理；真实台风首次出现后才下载图集。
  const atlas=createSprayAtlas();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocity, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: .7 },uSprayAtlas:atlas.uniforms.map,uSprayReady:atlas.uniforms.ready }, transparent: true, depthWrite: false,
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aKind;
      attribute float aSeed; attribute vec3 aVelocity;
      varying float vAlpha; varying float vKind; varying float vSeed; varying vec2 vAxis;
      void main() { vec4 p=modelViewMatrix*vec4(position,1.0); vAlpha=aAlpha; vKind=aKind; vSeed=aSeed;
      vec3 v=mat3(modelViewMatrix)*aVelocity; vAxis=normalize(vec2(v.x,-v.y)+vec2(0.0001));
      gl_PointSize=min(96.0,aSize*650.0/max(1.0,-p.z)); gl_Position=projectionMatrix*p; }`,
    fragmentShader: `uniform float uLight;uniform sampler2D uSprayAtlas;uniform float uSprayReady;
      varying float vAlpha; varying float vKind; varying float vSeed; varying vec2 vAxis;
      float sprayHash(vec2 p) { vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z); }
      float sprayNoise(vec2 p) { vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
        return mix(mix(sprayHash(i),sprayHash(i+vec2(1.0,0.0)),u.x),
          mix(sprayHash(i+vec2(0.0,1.0)),sprayHash(i+vec2(1.0)),u.x),u.y); }
      void main() { vec2 p=(gl_PointCoord-0.5)*2.0;
      vec2 q=vec2(dot(p,vec2(-vAxis.y,vAxis.x)),dot(p,vAxis));
      float drop=exp(-dot(q*vec2(3.1,1.25),q*vec2(3.1,1.25))*2.5);
      float ragged=0.70+0.18*sin(p.x*13.0+p.y*9.0+vSeed)+0.12*sin(p.y*23.0-p.x*7.0+vSeed*2.3);
      float mist=(1.0-smoothstep(0.12,ragged,length(p*vec2(1.0,1.18))))
        * (0.65+0.35*sin(p.x*21.0+p.y*17.0+vSeed));
      float width=0.18+smoothstep(-0.8,0.8,q.y)*0.52;
      float tears=sprayNoise(q*vec2(5.0,7.0)+vSeed)*0.62
        +sprayNoise(q*vec2(11.0,15.0)-vSeed*1.37)*0.38;
      float sheet=(1.0-smoothstep(width*0.5,width,abs(q.x)))
        * smoothstep(-0.95,-0.55,q.y)*(1.0-smoothstep(0.35,0.95,q.y))
        * smoothstep(0.25,0.64,tears);
      float shape=vKind>1.5?sheet:mix(drop,mist,vKind);
      if(uSprayReady>0.5&&vKind>0.5){
        vec2 uv=vec2(gl_PointCoord.x,1.0-gl_PointCoord.y);
        if(fract(vSeed*0.37)>.5)uv.x=1.0-uv.x;
        vec2 cell=vKind>1.5?vec2(1.0,1.0):vec2(0.0,0.0);
        float density=texture2D(uSprayAtlas,(cell+uv)*0.5).a;
        vec2 edge=smoothstep(vec2(0.0),vec2(0.07),uv)*(1.0-smoothstep(vec2(0.93),vec2(1.0),uv));
        shape=density*edge.x*edge.y*(vKind>1.5?0.65:0.25);
      }
      float a=shape*vAlpha; if(a<0.006) discard;
      gl_FragColor=vec4(vec3(0.87,0.94,0.95)*uLight,a); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = '拍岸浪花'; points.frustumCulled = false; points.renderOrder = 3; points.visible = false;
  // Attach lazily: a quiet sea retains its original single draw call.
  let attached = false, disposed = false, resting = false, limit = capacity, cursor = 0;
  let seed = 92317;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const plumes=createImpactPlumes(scene,atlas.uniforms,random);
  const breaker = {};
  function setQuality(quality) {
    limit = quality === 'low' ? 400 : quality === 'medium' ? 850 : capacity;
    geometry.setDrawRange(0, limit);
    for (let i = limit; i < capacity; i++) { ages[i] = 10; alphas[i] = 0; }
    cursor %= limit;
    plumes.setQuality(quality);
  }
  function step(delta, time, env, direction) {
    if (disposed) return;
    const strength = env.typhoon ?? 0;
    if (strength > .01) {
      atlas.load();
      resting = false;
      if (!attached) { scene.add(points); attached = true; }
    }
    if (!attached || resting) return;
    let active = 0;
    for (const source of sources) {
      const facing = Math.max(0, source.nx * direction[0] + source.nz * direction[1]);
      sampleTyphoonBreaker(source.x,source.z,time,direction,source.depth,source.exposure,strength,breaker);
      const crest=breaker.height;
      const impact=breaker.impact*facing;
      source.cooldown=Math.max(0,source.cooldown-delta);
      // A crest hits separate coast sections at different times. Trigger an
      // initial fan of fragments, then a shorter tail of crumbling spray.
      if(impact>.075 && source.previousImpact<=.075 && source.cooldown===0) {
        source.credit+=(14+impact*48)*(limit/capacity);
        source.cooldown=1.6;
        plumes.emit({x:source.x,y:Math.max(.2,crest*.35),z:source.z,impact,nx:source.nx,nz:source.nz,wind:direction});
      }
      source.previousImpact=impact;
      source.credit=Math.min(40,source.credit+delta*impact*90*(limit/capacity));
      while (source.credit >= 1) {
        source.credit--;
        const i = cursor; cursor = (cursor + 1) % limit;
        positions[i * 3] = source.x + (random() - .5) * 5;
        positions[i * 3 + 1] = Math.max(.4, crest) + random()*.7;
        positions[i * 3 + 2] = source.z + (random() - .5) * 5;
        const kind=random();const sheet=kind<.22,mist=!sheet&&kind<.54;
        kinds[i]=sheet?2:mist?1:0; seeds[i]=random()*50;
        const outward=3+random()*12,side=(random()-.5)*20;
        const drift=mist?9+random()*7:3+random()*5;
        velocity[i * 3]=direction[0]*drift-source.nx*outward-source.nz*side;
        velocity[i * 3 + 1]=mist?3+random()*5:7+random()*9+impact*2;
        velocity[i * 3 + 2]=direction[1]*drift-source.nz*outward+source.nx*side;
        ages[i]=0; lifetimes[i]=sheet?.8+random()*.7:mist?1.2+random()*1.5:2.1+random()*1.6;
        baseSizes[i]=sheet?1.2+random()*1.3:mist?1.8+random()*1.5:.22+random()*.55;
      }
    }
    for (let i = 0; i < limit; i++) {
      ages[i] += delta;
      const life = ages[i] / Math.max(.01, lifetimes[i]);
      if (life >= 1) { alphas[i] = 0; continue; }
      active++;
      positions[i * 3] += velocity[i * 3] * delta;
      const gravity=kinds[i]===1?3.4:9.8;
      positions[i * 3 + 1] += velocity[i * 3 + 1] * delta - gravity*.5*delta*delta;
      positions[i * 3 + 2] += velocity[i * 3 + 2] * delta;
      velocity[i * 3 + 1] -= delta * gravity;
      sizes[i]=baseSizes[i]*(kinds[i]===1?1+life*2.0:1+life*.25);
      alphas[i]=Math.sin(Math.PI*life)*(kinds[i]===1?.42:.9);
      if(positions[i*3+1]<0) { ages[i]=10; alphas[i]=0; }
    }
    points.visible = active > 0;
    const plumesActive = plumes.update(delta,env);
    // Finish the existing droplets and crowns before sleeping. A new storm
    // wakes the same pools without retaining per-frame work on a calm sea.
    resting = strength <= .01 && active === 0 && !plumesActive;
    material.uniforms.uLight.value = .12 + (env.daylight ?? 1) * .65
      * (1 - (env.cloudiness ?? 0) * .22) * (1 - (env.storm ?? 0) * .35);
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
  }
  let previousTime = null;
  function update(delta, time, env, direction) {
    // Fast animation and resumed frames still emit and integrate along the
    // intervening crests, rather than spawning a whole burst at the endpoint.
    const steps = Math.max(1, Math.ceil(delta / .08));
    const start = previousTime ?? time;
    for (let i = 1; i <= steps; i++) step(delta / steps, start + (time - start) * i / steps, env, direction);
    previousTime = time;
  }
  function dispose() { if (disposed) return; disposed = true; scene.remove(points); geometry.dispose(); material.dispose();plumes.dispose();atlas.dispose(); }
  return { update, setQuality, dispose, points,get ready(){return atlas.ready;} };
}
