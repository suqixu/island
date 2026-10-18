import {attachRuntimeOptions} from './runtime-options.js';
import * as THREE from 'three';
import config from './config/woodland-wildlife.json' with {type:'json'};
import {getAnimationDelta} from './animation-time.js';
import {getSnowCover,isSnowLandscape} from './snow-surface.js';
import {seededRandom} from './terrain.js';
import {createWildlifeView} from './wildlife-visibility.js';
import {createWoodlandAnimalMeshes} from './models/woodland-animals.js';
import {isCaveReserved} from './cave-layout.js';
import {isLighthouseReserved} from './lighthouse-layout.js';
import {isRestPavilionReserved} from './rest-pavilion-layout.js';
import {createSquirrelSurface} from './squirrel-texture.js';

const TAU=Math.PI*2,UP=new THREE.Vector3(0,1,0);
const smooth=value=>{const t=THREE.MathUtils.clamp(value,0,1);return t*t*(3-2*t);};

function createResidents(parent,kind,{perches,trees,crossings,heightAt,random,fur}) {
  const bird=kind==='bird',profile=config[kind],sites=bird?perches:trees;
  const capacity=Math.min(profile.counts.high,bird?sites.length:Math.max(sites.length?1:0,Math.floor(sites.length/2)));
  const group=new THREE.Group();group.name=bird?'林下小鸟':'山径松鼠';group.userData.woodlandAnimal=true;group.visible=false;parent.add(group);
  const {body,wings,tail,legs,meshes,look}=createWoodlandAnimalMeshes(kind,capacity,{fur});group.add(...meshes);
  const occupied=new Set(),view=createWildlifeView(),dummy=new THREE.Object3D(),part=new THREE.Object3D();
  const target=new THREE.Vector3(),normal=new THREE.Vector3(),tangent=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3();
  const basis=new THREE.Matrix4(),desired=new THREE.Quaternion(),partRotation=new THREE.Quaternion(),axisX=new THREE.Vector3(1,0,0),axisY=new THREE.Vector3(0,1,0);
  const cameraPosition=new THREE.Vector3();
  const footCenter=new THREE.Vector3(),footOffset=new THREE.Vector3(),normalA=new THREE.Vector3(),normalB=new THREE.Vector3();
  if(bird){const positions=body.geometry.attributes.position;let lowest=Infinity,count=0;for(let i=0;i<positions.count;i++)lowest=Math.min(lowest,positions.getY(i));for(let i=0;i<positions.count;i++)if(positions.getY(i)<lowest+1e-6){footCenter.add(target.fromBufferAttribute(positions,i));count++;}footCenter.divideScalar(count);}
  const seconds=phase=>{const [min,range]=profile.seconds[phase];return min+random()*range;};
  const agents=Array.from({length:capacity},()=>({phase:'waiting',age:0,duration:seconds('waiting'),site:null,tree:null,
    position:new THREE.Vector3(),from:new THREE.Vector3(),exit:new THREE.Vector3(),rotation:new THREE.Quaternion(),fromRotation:new THREE.Quaternion(),
    size:profile.size.min+random()*profile.size.range,visibility:0,departureScale:1,departureFold:0,
    yaw:0,angle:random()*TAU,flutter:random()*TAU,fraction:.06,fromFraction:.06,toFraction:.65,
    route:null,path:[],lengths:[],pathLength:0,pathP:0,crossed:false,extraTree:null,retreatP:0,retreatEnd:1,exiting:false,hideFrom:0,hideTo:0,lookAge:0,lookDuration:1.6,headYaw:0,headPitch:0,lookTarget:0,emergeFrom:0,emergeTo:0}));
  let disposed=false,quality='high',limit=capacity,lastTime,clock=0,poseAge=Infinity,wasEligible=false,hasCamera=false;
  function reset(agent){occupied.delete(agent.site);occupied.delete(agent.extraTree);agent.site=null;agent.tree=null;agent.extraTree=null;agent.phase='waiting';agent.age=0;agent.duration=seconds('waiting');agent.visibility=0;agent.route=null;agent.path=[];agent.crossed=false;agent.exiting=false;}
  function fold(agent){if(agent.phase==='perched')return 1;if(agent.phase==='arriving')return smooth((agent.age/agent.duration-.55)/.45);if(agent.phase==='departing')return agent.departureFold*(1-smooth(agent.age/.5));return 0;}
  function transition(agent,phase,duration){const previousFold=bird?fold(agent):0;agent.from.copy(agent.position);agent.fromRotation.copy(agent.rotation);agent.phase=phase;agent.age=0;agent.duration=duration??seconds(phase);
    if(bird&&phase==='departing'){agent.departureFold=previousFold;agent.departureScale=agent.visibility;agent.exit.copy(agent.position);agent.exit.x+=Math.sin(agent.angle)*5;agent.exit.z+=Math.cos(agent.angle)*5;agent.exit.y+=2;}
  }
  function safeFloor(point,clearance=.12){const floor=heightAt(point.x,point.z);if(Number.isFinite(floor))point.y=Math.max(point.y,floor+clearance);}
  function faceTrunk(agent,tree,point,time){
    // sampleTrunk 的角度属于树干局部坐标，先用真实法线恢复其世界朝向。
    tree.sampleTrunk(time,.06,0,0,target,normalA);tree.sampleTrunk(time,.06,Math.PI/2,0,target,normalB);
    normalA.y=0;normalA.normalize();normalB.y=0;normalB.normalize();
    tangent.copy(point).sub(tree.root);tangent.y=0;tangent.normalize();agent.angle=Math.atan2(tangent.dot(normalB),tangent.dot(normalA));
  }
  function preparePath(agent,time){
    const source=agent.path,distances=[0];for(let i=1;i<source.length;i++)distances.push(distances[i-1]+Math.hypot(source[i].x-source[i-1].x,source[i].z-source[i-1].z));
    function clearance(tree){let radius=0;for(let i=0;i<4;i++){tree.sampleTrunk(time,.025,i*Math.PI/2,0,target,normal);radius=Math.max(radius,Math.hypot(target.x-tree.root.x,target.z-tree.root.z));}return radius+.30*agent.size;}
    const start=clearance(agent.tree),end=distances.at(-1)-clearance(agent.extraTree);
    if(source.length<2||end-start<.5)return false;
    function pointAt(distance){let i=1;while(i<distances.length-1&&distances[i]<distance)i++;return new THREE.Vector3().lerpVectors(source[i-1],source[i],(distance-distances[i-1])/(distances[i]-distances[i-1]));}
    agent.path=[pointAt(start),...source.filter((point,i)=>distances[i]>start&&distances[i]<end),pointAt(end)];
    agent.lengths=[0];for(let i=1;i<agent.path.length;i++)agent.lengths.push(agent.lengths[i-1]+agent.path[i].distanceTo(agent.path[i-1]));agent.pathLength=agent.lengths.at(-1);
    faceTrunk(agent,agent.tree,agent.path[0],time);return true;
  }
  function chooseSite(agent,time){
    let candidates=sites;
    if(bird&&occupied.size&&random()<profile.companions.probability){
      const nearby=sites.filter(site=>{
        if(!site.available()||occupied.has(site))return false;site.sample(time,target);let neighbors=0;
        for(const other of agents){if(other.phase!=='perched')continue;other.site.sample(time,normal);const gap=target.distanceTo(normal);if(gap<profile.companions.minSeparation)return false;if(gap<profile.companions.radius)neighbors++;}
        return neighbors>0&&neighbors<=profile.companions.maxNeighbors;
      });
      if(nearby.length)candidates=nearby;
    }
    const first=Math.floor(random()*candidates.length);for(let step=0;step<candidates.length;step++){const site=candidates[(first+step)%candidates.length];if(!site.available()||occupied.has(site))continue;agent.site=site;occupied.add(site);agent.angle=random()*TAU;
      if(bird){site.sample(time,agent.position);agent.position.x+=Math.sin(agent.angle)*4;agent.position.z+=Math.cos(agent.angle)*4;agent.position.y+=1.8;agent.yaw=agent.angle+Math.PI;transition(agent,'arriving');}
      else{agent.tree=site;agent.fraction=.06;site.sampleTrunk(time,.06,agent.angle,.13*agent.size,agent.position,normal);agent.crossed=false;agent.route=null;
        if(random()<profile.crossingProbability){const available=crossings.filter(route=>route.available()&&(route.from===site||route.to===site)&&!occupied.has(route.from===site?route.to:route.from));
          if(available.length){agent.route=available[Math.floor(random()*available.length)];agent.extraTree=agent.route.from===site?agent.route.to:agent.route.from;occupied.add(agent.extraTree);agent.path=agent.route.from===site?agent.route.points:agent.route.points.slice().reverse();if(!preparePath(agent,time)){occupied.delete(agent.extraTree);agent.extraTree=null;agent.route=null;agent.path=[];}}}
        if(hasCamera){target.copy(site.root).sub(cameraPosition).setY(0).normalize().add(site.root);faceTrunk(agent,site,target,time);}agent.emergeFrom=agent.angle;agent.emergeTo=agent.angle+Math.PI*.85;
        site.sampleTrunk(time,.06,agent.angle,.13*agent.size,agent.position,normal);
        transition(agent,'emerging');}
      return;}}
  function treePose(agent,time,fraction){agent.tree.sampleTrunk(time,fraction,agent.angle,.13*agent.size,agent.position,normal);agent.tree.sampleTrunk(time,Math.min(.98,fraction+.005),agent.angle,.13*agent.size,target,up);
    tangent.subVectors(target,agent.position).normalize();if(['descending','shelteringTree','leaving'].includes(agent.phase))tangent.negate();
    up.copy(normal).addScaledVector(tangent,-normal.dot(tangent)).normalize();right.crossVectors(up,tangent).normalize();up.crossVectors(tangent,right).normalize();basis.makeBasis(right,up,tangent);desired.setFromRotationMatrix(basis);
  }
  function track(agent,p){const at=THREE.MathUtils.clamp(p,0,1)*agent.pathLength;let index=1;while(index<agent.lengths.length-1&&agent.lengths[index]<at)index++;
    const span=agent.lengths[index]-agent.lengths[index-1];agent.position.lerpVectors(agent.path[index-1],agent.path[index],span>0?(at-agent.lengths[index-1])/span:0);agent.position.y+=.13*agent.size;
    tangent.subVectors(agent.path[index],agent.path[index-1]).normalize();if(agent.phase==='shelteringWalk'&&agent.retreatEnd===0)tangent.negate();right.crossVectors(UP,tangent).normalize();up.crossVectors(tangent,right).normalize();basis.makeBasis(right,up,tangent);desired.setFromRotationMatrix(basis);
  }
  function startClimb(agent){agent.fromFraction=agent.fraction;agent.toFraction=.55+random()*.15;transition(agent,'climbing');}
  function hideBehindTree(agent){agent.hideFrom=agent.angle;agent.hideTo=agent.angle+Math.PI*(.8+random()*.4);transition(agent,'hiding');}
  function exitPath(agent,time){
    const source=agent.position.clone(),outward=source.clone().sub(agent.tree.root).setY(0).normalize();
    if(outward.lengthSq()<.1)outward.set(Math.cos(agent.angle),0,Math.sin(agent.angle));
    const lateral=hasCamera?new THREE.Vector3().subVectors(source,cameraPosition).setY(0).normalize().cross(UP):new THREE.Vector3(-outward.z,0,outward.x);
    const sign=random()<.5?-1:1,choices=[lateral.clone().multiplyScalar(sign),lateral.clone().multiplyScalar(-sign),outward.clone(),new THREE.Vector3(-outward.z,0,outward.x)],radii=new Map();
    for(const tree of trees)if(tree.available()){tree.sampleTrunk(time,.025,0,0,target,normal);radii.set(tree,Math.hypot(target.x-tree.root.x,target.z-tree.root.z)+.24);}
    source.y=heightAt(source.x,source.z)+.13*agent.size;let best=[];
    for(const direction of choices){
      const path=[source.clone()],distance=profile.exit.distance[0]+random()*profile.exit.distance[1],curve=(random()-.5)*1.2;
      for(let d=.5;d<=distance;d+=.5){
        const side=curve*Math.sin(d/distance*Math.PI),x=source.x+outward.x*Math.min(.65,d)+direction.x*Math.max(0,d-.65)-direction.z*side,z=source.z+outward.z*Math.min(.65,d)+direction.z*Math.max(0,d-.65)+direction.x*side,y=heightAt(x,z);
        const previous=path.at(-1);if(!Number.isFinite(y)||y<.2||Math.abs(y+.13*agent.size-previous.y)/.5>.7||isCaveReserved(x,z,.25)||isLighthouseReserved(x,z,.25)||isRestPavilionReserved(x,z,.25))break;
        if([...radii].some(([tree,radius])=>Math.hypot(x-tree.root.x,z-tree.root.z)<radius))break;
        path.push(new THREE.Vector3(x,y+.13*agent.size,z));
      }
      if(path.length>best.length)best=path;if(best.length>14)break;
    }
    if(best.length<4)return false;
    agent.path=best;agent.lengths=[0];for(let i=1;i<best.length;i++)agent.lengths.push(agent.lengths[i-1]+best[i].distanceTo(best[i-1]));agent.pathLength=agent.lengths.at(-1);agent.pathP=0;agent.exiting=true;return true;
  }
  function beginExit(agent,time){if(exitPath(agent,time))transition(agent,'grounding');else hideBehindTree(agent);}
  function squirrelNext(agent,time){switch(agent.phase){
    case 'emerging':case 'mounting':startClimb(agent);break;
    case 'climbing':transition(agent,'observing');break;
    case 'observing':agent.fromFraction=agent.fraction;agent.toFraction=.06;transition(agent,'descending');break;
    case 'descending':if(agent.route&&!agent.crossed&&agent.route.available())transition(agent,'grounding');else beginExit(agent,time);break;
    case 'grounding':agent.pathP=0;transition(agent,agent.exiting?'escaping':'crossing',agent.pathLength/(agent.exiting?profile.exit.speed:profile.walkingSpeed));break;
    case 'crossing':occupied.delete(agent.site);agent.site=agent.extraTree;agent.tree=agent.extraTree;agent.extraTree=null;agent.crossed=true;agent.fraction=.06;faceTrunk(agent,agent.tree,agent.path.at(-1),time);transition(agent,'mounting');break;
    case 'escaping':if(!hasCamera||!view.intersects(agent.position,.7))reset(agent);else transition(agent,'escapeWait');break;
    case 'escapeWait':if(!hasCamera||!view.intersects(agent.position,.7))reset(agent);else if(exitPath(agent,time))transition(agent,'escaping',agent.pathLength/profile.exit.speed);else transition(agent,'escapeWait');break;
    case 'hiding':{const radial=agent.position.clone().sub(agent.tree.root).setY(0).normalize(),towardCamera=cameraPosition.clone().sub(agent.tree.root).setY(0).normalize();if(!hasCamera||!view.intersects(agent.position,.7)||radial.dot(towardCamera)<-.3)reset(agent);else hideBehindTree(agent);break;}
    default:reset(agent);
  }}
  function loseHost(agent){if(agent.phase==='hostLost')return;agent.departureScale=agent.visibility;transition(agent,'hostLost',.55);}
  function retreat(agent){if(['shelteringTree','shelteringWalk','shelteringGround','leaving','hostLost'].includes(agent.phase))return;
    agent.departureScale=agent.visibility;
    if(['crossing','escaping','escapeWait'].includes(agent.phase)){const sourceAvailable=agent.tree.available(),targetAvailable=agent.extraTree?.available();if(!sourceAvailable&&!targetAvailable){loseHost(agent);return;}agent.retreatP=agent.pathP;agent.retreatEnd=sourceAvailable&&(!targetAvailable||agent.pathP<.5)?0:1;transition(agent,'shelteringWalk',Math.max(.8,Math.abs(agent.retreatEnd-agent.retreatP)*agent.pathLength/profile.walkingSpeed));}
    else if(['grounding','mounting'].includes(agent.phase)){agent.exit.copy(agent.phase==='grounding'?agent.path[0]:agent.path.at(-1));agent.exit.y+=.13*agent.size;transition(agent,'shelteringGround');}
    else{agent.fromFraction=agent.fraction;agent.toFraction=.025;transition(agent,'shelteringTree');}
  }
  function advanceBird(agent,dt,time,eligible){if(agent.phase!=='departing'&&(!eligible||!agent.site.available()))transition(agent,'departing');
    if(agent.age>=agent.duration){if(agent.phase==='arriving')transition(agent,'perched');else if(agent.phase==='perched')transition(agent,'departing');else{reset(agent);return;}}
    const oldX=agent.position.x,oldZ=agent.position.z,p=agent.age/agent.duration,blend=smooth(p);
    if(agent.phase==='departing'){agent.position.lerpVectors(agent.from,agent.exit,blend);agent.visibility=agent.departureScale*(1-smooth((p-.65)/.35));}
    else{
      if(agent.site.sampleFrame){agent.site.sampleFrame(time,target,normal,right);right.normalize();up.copy(UP).addScaledVector(right,-UP.dot(right)).normalize();tangent.crossVectors(right,up).normalize();up.crossVectors(tangent,right).normalize();basis.makeBasis(right,up,tangent);desired.setFromRotationMatrix(basis);}
      else{agent.site.sample(time,target);desired.setFromAxisAngle(axisY,agent.yaw+(agent.phase==='perched'?Math.sin(clock*.9+agent.flutter)*.04:0));}
      footOffset.copy(footCenter).applyQuaternion(desired).multiplyScalar(agent.size);target.sub(footOffset);
      if(agent.phase==='perched'){agent.position.copy(target);agent.rotation.copy(desired);}else{agent.position.lerpVectors(agent.from,target,blend);agent.position.y+=Math.sin(Math.PI*p)*.6;}
      agent.visibility=agent.phase==='arriving'?smooth(agent.age/.6):1;
    }
    safeFloor(agent.position);if(agent.phase!=='perched'){const dx=agent.position.x-oldX,dz=agent.position.z-oldZ;if(Math.hypot(dx,dz)>.0001){const angle=Math.atan2(dx,dz),turn=Math.atan2(Math.sin(angle-agent.yaw),Math.cos(angle-agent.yaw));agent.yaw+=turn*(1-Math.exp(-dt*8));}}
    if(agent.phase!=='perched'){agent.rotation.setFromAxisAngle(axisY,agent.yaw);if(agent.phase==='arriving')agent.rotation.slerp(desired,smooth((p-.55)/.45));else agent.rotation.slerp(agent.fromRotation,1-smooth(agent.age/.5));}
  }
  function advanceSquirrel(agent,dt,time,eligible){
    const lookRandom=agent.lookRandom??=seededRandom(agent.flutter*4294967296);agent.lookAge+=dt;if(agent.lookAge>agent.lookDuration){agent.lookAge=0;agent.lookDuration=.7+lookRandom()*2.4;agent.lookTarget=(lookRandom()-.5)*.9;}
    const alert=['observing','escapeWait'].includes(agent.phase);agent.headYaw+=(agent.lookTarget*(alert?1:.22)-agent.headYaw)*(1-Math.exp(-dt*4));agent.headPitch+=(alert?Math.sin(clock*5.2+agent.flutter)*.055-agent.headPitch:-agent.headPitch)*(1-Math.exp(-dt*5));
    if(agent.phase!=='hostLost'){
      if(agent.phase==='crossing'){if(!eligible||!agent.route.available()||!agent.tree.available()||!agent.extraTree?.available())retreat(agent);}
      else if(agent.phase==='shelteringWalk'){const destination=agent.retreatEnd===0?agent.tree:agent.extraTree;if(!destination?.available())loseHost(agent);}
      else if(!agent.tree.available())loseHost(agent);
      else if(!eligible)retreat(agent);
      else if(agent.phase==='grounding'&&!agent.exiting&&(!agent.route.available()||!agent.extraTree?.available()))retreat(agent);
    }
    if(agent.age>=agent.duration)squirrelNext(agent,time);if(agent.phase==='waiting')return;
    const p=agent.age/agent.duration,blend=smooth(p);
    if(['climbing','descending','shelteringTree'].includes(agent.phase))agent.fraction=THREE.MathUtils.lerp(agent.fromFraction,agent.toFraction,blend);
    if(agent.phase==='emerging'&&hasCamera)agent.angle=THREE.MathUtils.lerp(agent.emergeFrom,agent.emergeTo,blend);
    if(agent.phase==='hiding'){agent.angle=THREE.MathUtils.lerp(agent.hideFrom,agent.hideTo,blend);treePose(agent,time,.025);}
    else if(['emerging','climbing','observing','descending','leaving','shelteringTree'].includes(agent.phase))treePose(agent,time,agent.fraction);
    else if(['crossing','escaping'].includes(agent.phase)){agent.pathP=blend;track(agent,blend);}
    else if(agent.phase==='shelteringWalk')track(agent,THREE.MathUtils.lerp(agent.retreatP,agent.retreatEnd,blend));
    else if(agent.phase==='grounding'){target.copy(agent.path[0]);target.y+=.13*agent.size;agent.position.lerpVectors(agent.from,target,blend);desired.setFromAxisAngle(axisY,Math.atan2(agent.path[1].x-agent.path[0].x,agent.path[1].z-agent.path[0].z));}
    else if(agent.phase==='mounting'){treePose(agent,time,.06);target.copy(agent.position);agent.position.lerpVectors(agent.from,target,blend);}
    else if(agent.phase==='shelteringGround'){agent.position.lerpVectors(agent.from,agent.exit,blend);safeFloor(agent.position,.13*agent.size);}
    if(agent.phase!=='hostLost')agent.rotation.slerp(desired,1-Math.exp(-dt*10));
    if(agent.phase==='escaping'&&agent.age>.3&&hasCamera&&!view.intersects(agent.position,.7)){reset(agent);return;}
    agent.visibility=agent.phase==='hostLost'?agent.departureScale*(1-smooth(p)):agent.phase==='emerging'?(hasCamera?1:smooth(p)):agent.phase.startsWith('sheltering')?agent.departureScale*(1-smooth((p-.55)/.45)):agent.phase==='leaving'?1-smooth(p):1;
  }
  function advance(agent,dt,time,eligible){agent.age+=dt;if(agent.phase==='waiting'){if(!eligible){agent.age=0;return;}if(agent.age>=agent.duration)chooseSite(agent,time);if(agent.phase==='waiting')return;}if(bird)advanceBird(agent,dt,time,eligible);else advanceSquirrel(agent,dt,time,eligible);}
  const joint=new THREE.Vector3(),rotatedJoint=new THREE.Vector3(),jointOffset=new THREE.Vector3();
  function writePart(mesh,agent,index,rotation,pivot){part.position.copy(agent.position);if(pivot){jointOffset.copy(pivot).sub(rotatedJoint.copy(pivot).applyQuaternion(rotation)).multiplyScalar(agent.size).applyQuaternion(agent.rotation);part.position.add(jointOffset);}part.quaternion.copy(agent.rotation).multiply(rotation);part.scale.setScalar(agent.size*agent.visibility);part.updateMatrix();mesh.setMatrixAt(index,part.matrix);}
  function writePose(agent,index){dummy.position.copy(agent.position);dummy.quaternion.copy(agent.rotation);dummy.scale.setScalar(agent.size*agent.visibility);dummy.updateMatrix();body.setMatrixAt(index,dummy.matrix);
    if(bird){const folded=fold(agent),flap=Math.sin(clock*13+agent.flutter)*.7*(1-folded);for(let side=0;side<2;side++){const sign=side===0?1:-1;partRotation.setFromEuler(new THREE.Euler(0,sign*1.2*folded,sign*flap));writePart(wings[side],agent,index,partRotation);}}
    else{look.setXY(index,agent.headYaw,agent.headPitch);const running=agent.phase==='escaping',moving=['climbing','descending','crossing','escaping','mounting','grounding','shelteringTree','shelteringWalk'].includes(agent.phase),stride=['crossing','escaping'].includes(agent.phase)?agent.pathP*agent.pathLength*14:clock*16+agent.flutter;
      for(let leg=0;leg<legs.length;leg++){const phase=running?(leg<2?0:Math.PI):(leg===0||leg===3?0:Math.PI);partRotation.setFromAxisAngle(axisX,moving?Math.sin(stride+phase)*(running?.40:.26):0);joint.set((leg%2===0?-1:1)*.075,-.025,leg<2?.12:-.12);writePart(legs[leg],agent,index,partRotation,joint);}
      partRotation.setFromEuler(new THREE.Euler((running?-.24:0)+Math.sin(clock*2.7+agent.flutter)*.065,Math.sin(clock*1.7+agent.flutter)*.13,0));writePart(tail,agent,index,partRotation);}
  }
  function writePoses(){for(let i=0;i<limit;i++)writePose(agents[i],i);for(const mesh of meshes)mesh.instanceMatrix.needsUpdate=true;if(look)look.needsUpdate=true;poseAge=0;}
  function setQuality(value='high'){if(disposed)return;quality=Object.hasOwn(profile.counts,value)?value:'high';limit=Math.min(capacity,profile.counts[quality]);for(let i=limit;i<capacity;i++)reset(agents[i]);for(const mesh of meshes)mesh.count=limit;poseAge=Infinity;}
  function update(time,env={},camera){if(disposed)return;const now=Number.isFinite(time)?time:(lastTime??0),dt=lastTime===undefined?0:getAnimationDelta(now-lastTime,.1,env);lastTime=now;clock+=dt;poseAge+=dt;if(env.quality&&env.quality!==quality)setQuality(env.quality);
    hasCamera=Boolean(camera);const eligible=(env.daylight??1)>config.activity.minDaylight&&(env.rain??0)<config.activity.maxRain&&(env.windSpeed??(2+(env.wind??.3)*20))<config.activity.maxWindSpeed&&(env.storm??0)<.3&&!isSnowLandscape(env)&&getSnowCover(env)===0;
    if(eligible&&!wasEligible)for(const agent of agents)if(agent.phase==='waiting')reset(agent);wasEligible=eligible;view.update(camera);
    let active=false,visible=false,distance=Infinity;if(camera)camera.getWorldPosition(cameraPosition);
    for(let i=0;i<limit;i++){const agent=agents[i];advance(agent,dt,now,eligible);if(agent.visibility<=0)continue;active=true;visible ||= view.intersects(agent.position,1.5);if(camera)distance=Math.min(distance,cameraPosition.distanceToSquared(agent.position));}
    distance=camera?Math.sqrt(distance):0;const wasVisible=group.visible;group.visible=active&&visible&&distance<config.distance.hidden;if(!active&&wasVisible)writePoses();if(!group.visible||(wasVisible&&distance>config.distance.fullRate&&poseAge<config.distance.updateSeconds))return;writePoses();
  }
  function dispose(){if(disposed)return;disposed=true;for(const agent of agents)reset(agent);const geometries=new Set(),materials=new Set();for(const mesh of meshes){mesh.dispose();geometries.add(mesh.geometry);materials.add(mesh.material);}for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();group.removeFromParent();group.clear();}
  function observe(){
    const current=agents.slice(0,limit).filter(agent=>agent.visibility>.75);
    const agent=current.find(agent=>['perched','observing','climbing'].includes(agent.phase))??current[0];if(!agent||disposed)return null;
    const host=agent.site,position=agent.position.clone(),remembered=position.clone();
    const outward=agent.tree?position.clone().sub(agent.tree.root).setY(0):position.clone().setY(0);
    return {position,outward,focus(target){if(!disposed&&agent.site===host&&agent.visibility>.1&&!['escaping','escapeWait','hiding'].includes(agent.phase))remembered.copy(agent.position);return target.copy(remembered);}};
  }
  writePoses();return attachRuntimeOptions({group,update,setQuality,observe,dispose},{[bird?'woodlandBird':'squirrel']:{capacity,counts:profile.counts,batches:[{body,parts:meshes.filter(mesh=>mesh!==body).map(mesh=>({mesh}))}]}});
}

export function createWoodlandWildlife(parent,{perches=[],trees=[],crossings=[],heightAt=()=>0,random=Math.random}={}) {
  const group=new THREE.Group();group.name='林下与山径生灵';group.userData.woodlandAnimal=true;group.userData.habitatCounts={perches:perches.length,trees:trees.length,crossings:crossings.length};parent.add(group);
  const fur=createSquirrelSurface(),residents=['bird','squirrel'].map(kind=>createResidents(group,kind,{perches,trees,crossings,heightAt,fur:fur.uniforms,random:seededRandom(random()*4294967296)}));let disposed=false;
  return {group,getRuntimeProviders:()=>({woodlandBird:residents[0],squirrel:residents[1]}),setFurMap:fur.setMap,getObservationTarget(){return disposed?null:residents[1].observe()??residents[0].observe();},update(time,env,camera){if(!disposed)for(const resident of residents)resident.update(time,env,camera);},setQuality(value){if(!disposed)for(const resident of residents)resident.setQuality(value);},dispose(){if(disposed)return;disposed=true;for(const resident of residents)resident.dispose();fur.dispose();group.removeFromParent();group.clear();}};
}
