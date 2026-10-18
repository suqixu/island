import {attachRuntimeOptions} from './runtime-options.js';
import * as THREE from 'three';
import config from './config/meadow-insects.json' with { type: 'json' };
import { getAnimationDelta } from './animation-time.js';
import { createWildlifeView } from './wildlife-visibility.js';
import { seededRandom } from './terrain.js';
import { canInsectsFly } from './insect-weather.js';
import { createMeadowInsectMeshes } from './models/meadow-insects.js';

const TAU = Math.PI * 2;
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t*t*(3-2*t); };

function createColony(parent, kind, { anchors, heightAt, random, reservations }) {
  const bee = kind === 'bee', profile = config[kind];
  const group = new THREE.Group(); group.name = bee ? '花丛蜜蜂' : '草间蜻蜓'; group.userData.meadowInsect = true; group.visible = false; parent.add(group);
  const capacity = Math.min(profile.counts.high, anchors.length), { body, wings, meshes } = createMeadowInsectMeshes(kind, capacity); group.add(...meshes);
  const duration = phase => profile.seconds[phase].min + random()*profile.seconds[phase].range;
  const flower = new THREE.Vector3(), candidate = new THREE.Vector3(), cameraPosition = new THREE.Vector3();
  const dummy = new THREE.Object3D(), wing = new THREE.Object3D(), flapRotation = new THREE.Quaternion(), axis = new THREE.Vector3(0,0,1);
  const view = createWildlifeView();
  const anchorPositions = anchors.map(anchor=>anchor.sample(0,new THREE.Vector3()));
  const agents = Array.from({length:capacity},()=>({
    phase:'waiting',age:0,duration:duration('waiting'),anchor:null,visited:new Set(),visits:0,visitLimit:0,
    position:new THREE.Vector3(),from:new THREE.Vector3(),target:new THREE.Vector3(),yaw:0,heading:random()*TAU,
    flutter:random()*TAU,size:profile.size.min+random()*profile.size.range,visibility:0,departureScale:1,
  }));
  let limit=capacity,quality='high',previousTime,clock=0,poseAge=Infinity,disposed=false,wasEligible=false;
  function release(agent) { if(bee&&agent.anchor)reservations.delete(agent.anchor); }
  function reset(agent) {
    release(agent);agent.anchor=null;agent.phase='waiting';agent.age=0;agent.duration=duration('waiting');agent.visibility=0;agent.visited.clear();
  }
  function transition(agent,phase) {
    agent.from.copy(agent.position);agent.phase=phase;agent.age=0;agent.duration=duration(phase);
    if(phase==='departing') {
      agent.departureScale=agent.visibility;
      agent.target.copy(agent.position);agent.target.x+=Math.sin(agent.heading)*3.5;agent.target.z+=Math.cos(agent.heading)*3.5;agent.target.y+=1;
      liftAboveTerrain(agent.target,.8);
    }
  }
  function liftAboveTerrain(point,clearance) {
    const floor=heightAt(point.x,point.z);if(Number.isFinite(floor))point.y=Math.max(point.y,floor+clearance);
  }
  function chooseFlower(agent,time,first=false) {
    let selected=null,best=Infinity;
    const start=Math.floor(random()*anchors.length);
    for(let step=0;step<anchors.length;step++) {
      const anchor=anchors[(start+step)%anchors.length];
      if(!anchor.available()||reservations.has(anchor)||agent.visited.has(anchor))continue;
      if(first){selected=anchor;break;}
      anchor.sample(time,candidate);
      const distance=candidate.distanceTo(agent.position);
      if(distance<.6||distance>profile.maxFlowerDistance)continue;
      if(distance<best){best=distance;selected=anchor;}
    }
    if(!selected)return false;
    release(agent);agent.anchor=selected;reservations.add(selected);agent.visited.add(selected);return true;
  }
  function chooseHover(agent,time) {
    agent.anchor.sample(time,agent.target);
    const angle=random()*TAU,radius=.7+random()*2;
    agent.target.x+=Math.cos(angle)*radius;agent.target.z+=Math.sin(angle)*radius;agent.target.y+=1.2+random()*.7;
    liftAboveTerrain(agent.target,.9);
  }
  function begin(agent,time) {
    if(bee) { if(!chooseFlower(agent,time,true))return;agent.anchor.sample(time,agent.target);agent.target.y+=.65; }
    else {
      const start=Math.floor(random()*anchors.length);
      agent.anchor=null;
      for(let step=0;step<anchors.length;step++) {
        const anchor=anchors[(start+step)%anchors.length];
        if(anchor.available()){agent.anchor=anchor;break;}
      }
      if(!agent.anchor)return;
      chooseHover(agent,time);
    }
    agent.visits=0;agent.visitLimit=profile.visits.min+Math.floor(random()*profile.visits.range);
    agent.heading=random()*TAU;
    agent.position.copy(agent.target);agent.position.x+=Math.sin(agent.heading)*3;agent.position.z+=Math.cos(agent.heading)*3;agent.position.y+=.4;
    liftAboveTerrain(agent.position,.8);agent.yaw=agent.heading+Math.PI;transition(agent,'entering');
  }
  function next(agent,time,eligible) {
    if(agent.phase==='departing'){reset(agent);return;}
    if(bee) {
      if(agent.phase==='entering'||agent.phase==='moving')transition(agent,'landing');
      else if(agent.phase==='landing'){agent.visits++;transition(agent,'feeding');}
      else if(eligible&&agent.visits<agent.visitLimit&&chooseFlower(agent,time))transition(agent,'moving');
      else transition(agent,'departing');
    }else {
      if(agent.phase==='hover') {
        if(++agent.visits>=agent.visitLimit)transition(agent,'departing');
        else {chooseHover(agent,time);transition(agent,'moving');}
      }else transition(agent,'hover');
    }
  }
  function advance(agent,dt,time,eligible) {
    agent.age+=dt;
    if(agent.phase==='waiting') {
      if(!eligible){agent.age=0;return;}
      if(agent.age>=agent.duration)begin(agent,time);
      if(agent.phase==='waiting')return;
    }
    if(agent.phase!=='departing'&&(!eligible||!agent.anchor.available()))transition(agent,'departing');
    if(agent.age>=agent.duration)next(agent,time,eligible);
    if(agent.phase==='waiting')return;
    const oldX=agent.position.x,oldZ=agent.position.z,p=agent.age/agent.duration,blend=smooth(p);
    if(bee&&agent.phase!=='departing') {
      agent.anchor.sample(time,agent.target);
      agent.target.y+=agent.phase==='landing'||agent.phase==='feeding' ? .09*agent.size : .65;
    }
    if(agent.phase==='feeding')agent.position.copy(agent.target);
    else if(agent.phase==='hover') {
      agent.position.copy(agent.target);
      // 停悬围绕固定世界位置微调，不能跟随不断漂移的目标。
      const settle=smooth(agent.age/.25);
      agent.position.x+=Math.sin(clock*2.1+agent.flutter)*.018*settle;
      agent.position.y+=Math.sin(clock*2.8+agent.flutter)*.013*settle;
      agent.position.z+=Math.cos(clock*1.9+agent.flutter)*.018*settle;
    }else {
      agent.position.lerpVectors(agent.from,agent.target,blend);
      agent.position.y+=Math.sin(Math.PI*p)*.32;
    }
    liftAboveTerrain(agent.position,.08);
    agent.visibility=agent.phase==='entering'?smooth(agent.age/.55):agent.phase==='departing'?agent.departureScale*(1-smooth((p-.65)/.35)):1;
    if(agent.phase!=='feeding'&&agent.phase!=='hover') {
      const dx=agent.position.x-oldX,dz=agent.position.z-oldZ;
      if(Math.hypot(dx,dz)>.0001){const target=Math.atan2(dx,dz),turn=Math.atan2(Math.sin(target-agent.yaw),Math.cos(target-agent.yaw));agent.yaw+=turn*(1-Math.exp(-dt*10));}
    }
  }
  function writePose(agent,index) {
    const feeding=agent.phase==='feeding'?smooth(agent.age/.25):0;
    dummy.position.copy(agent.position);dummy.rotation.set(0,agent.yaw,0);dummy.scale.setScalar(agent.size*agent.visibility);dummy.updateMatrix();body.setMatrixAt(index,dummy.matrix);
    const flap=Math.sin(clock*(bee ? 63 : 49)+agent.flutter)*(bee ? .40 : .24)*(1-feeding*.9);
    for(let side=0;side<2;side++) {
      flapRotation.setFromAxisAngle(axis,(side===0?1:-1)*(flap+.13));
      wing.position.copy(agent.position);wing.quaternion.copy(dummy.quaternion).multiply(flapRotation);wing.scale.copy(dummy.scale);wing.updateMatrix();wings[side].setMatrixAt(index,wing.matrix);
    }
  }
  function writePoses() {for(let index=0;index<limit;index++)writePose(agents[index],index);for(const mesh of meshes)mesh.instanceMatrix.needsUpdate=true;poseAge=0;}
  function setQuality(value='high') {
    if(disposed)return;quality=Object.hasOwn(profile.counts,value)?value:'high';limit=Math.min(capacity,profile.counts[quality]);
    for(let index=limit;index<capacity;index++)reset(agents[index]);for(const mesh of meshes)mesh.count=limit;poseAge=Infinity;
  }
  function update(time,env={},camera) {
    if(disposed)return;
    const now=Number.isFinite(time)?time:(previousTime??0),dt=previousTime===undefined?0:getAnimationDelta(now-previousTime,.1,env);previousTime=now;clock+=dt;poseAge+=dt;
    if(env.quality&&env.quality!==quality)setQuality(env.quality);
    const eligible=canInsectsFly(env,config.activity);
    if(eligible&&!wasEligible)for(const agent of agents)if(agent.phase==='waiting')reset(agent);wasEligible=eligible;
    view.update(camera);
    let active=false,inView=false;for(let index=0;index<limit;index++){advance(agents[index],dt,now,eligible);if(agents[index].visibility>0){active=true;inView ||= view.intersects(agents[index].position,.65);}}
    let distance=0;
    if(camera&&anchors.length){camera.getWorldPosition(cameraPosition);distance=Infinity;for(const point of anchorPositions)distance=Math.min(distance,cameraPosition.distanceToSquared(point));distance=Math.sqrt(distance);}
    const wasVisible=group.visible;group.visible=active&&inView&&distance<config.distance.hidden;
    if(!active&&wasVisible)writePoses();
    if(!group.visible||(wasVisible&&distance>config.distance.fullRate&&poseAge<config.distance.updateSeconds))return;
    writePoses();
  }
  function dispose() {
    if(disposed)return;disposed=true;for(const agent of agents)release(agent);
    const materials=new Set();for(const mesh of meshes){mesh.dispose();mesh.geometry.dispose();materials.add(mesh.material);}for(const material of materials)material.dispose();group.removeFromParent();group.clear();
  }
  writePoses();return attachRuntimeOptions({group,update,setQuality,dispose},{[kind]:{capacity,counts:profile.counts,batches:[{body,parts:meshes.filter(mesh=>mesh!==body).map(mesh=>({mesh}))}]}});
}

export function createMeadowInsects(parent,{anchors=[],heightAt=()=>0,random= Math.random,reservations=new Set()}={}) {
  const group=new THREE.Group();group.name='花丛访客';group.userData.meadowInsect=true;parent.add(group);
  // 各物种从运行时种子创建自己的随机流，彼此更新不会消耗对方的随机状态。
  const colonies=['bee','dragonfly'].map(kind=>createColony(group,kind,{anchors,heightAt,reservations,random:seededRandom(random()*4294967296)}));
  let disposed=false;
  return {group,getRuntimeProviders:()=>Object.fromEntries(colonies.map((p,i)=>[['bee','dragonfly'][i],p])),
    update(time,env,camera){if(!disposed)for(const colony of colonies)colony.update(time,env,camera);},
    setQuality(value){if(!disposed)for(const colony of colonies)colony.setQuality(value);},
    dispose(){if(disposed)return;disposed=true;for(const colony of colonies)colony.dispose();group.removeFromParent();group.clear();},
  };
}
