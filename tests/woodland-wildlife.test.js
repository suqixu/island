import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { seededRandom } from '../src/terrain.js';

const api=await import('../src/woodland-wildlife.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const day={daylight:1,seasonIndex:1,windSpeed:5,rain:0,snow:0,snowCover:0};
function habitat() {
  const trees=[0,6].map(x=>({root:new THREE.Vector3(x,2,0),height:4,available:()=>true,
    sampleTrunk(time,fraction,angle,standOff,target,normal){normal.set(Math.cos(angle),0,Math.sin(angle));return target.copy(this.root).addScaledVector(normal,.2+standOff).add(new THREE.Vector3(Math.sin(time)*.05,fraction*4,0));}}));
  const perches=[0,1].map((i)=>({kind:i?'rail':'branch',available:()=>true,sample(time,target){return target.set(i*6+Math.sin(time)*.05,4,0);}}));
  const crossings=[{from:trees[0],to:trees[1],available:()=>true,points:Array.from({length:25},(_,i)=>new THREE.Vector3(i/4,2,0))}];
  return {trees,perches,crossings};
}
function create(options={}) {assert.equal(typeof api.createWoodlandWildlife,'function','需要林鸟和松鼠行为实现');return api.createWoodlandWildlife(new THREE.Group(),{...habitat(),heightAt:()=>2,random:seededRandom(72),...options});}
function pose(effect,name,index=0) {const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();effect.group.getObjectByName(name).getMatrixAt(index,matrix);matrix.decompose(position,rotation,scale);return {position,rotation,size:scale.x};}
function advance(effect,from,to,env=day,camera){for(let i=Math.round(from*20);i<=Math.round(to*20);i++)effect.update(i/20,env,camera);}

test('晴天活动结束时先连续离开视野，不能在镜头内原地缩小消失',()=>{
  const effect=create(),camera=new THREE.PerspectiveCamera(55,1,.1,500);camera.position.set(3,5,12);camera.lookAt(3,3,0);camera.updateMatrixWorld();
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));let previous,fades=0,moving=0;
  try{for(let i=0;i<2400;i++){effect.update(i/20,day,camera);const current=pose(effect,'松鼠身体');
    if(previous&&current.size>.25&&previous.size>.4&&frustum.containsPoint(current.position)){
      if(current.size<previous.size-.003&&current.position.distanceTo(previous.position)<.008)fades++;
      if(current.position.distanceTo(previous.position)>.025&&current.position.y<2.2)moving++;
    }previous=current;
  }assert.equal(fades,0,'不能在可见树干上逐渐缩小');assert.ok(moving>10,'应有连续的贴地移动');}finally{effect.dispose();}
});

test('摄影观察位置读取当前行为状态，离屏时也不依赖旧实例矩阵',()=>{
  const effect=create(),camera=new THREE.PerspectiveCamera(60,1,.1,500);camera.position.set(3,5,12);camera.lookAt(3,5,30);
  try{assert.equal(typeof effect.getObservationTarget,'function');advance(effect,0,12,day,camera);
    const body=effect.group.getObjectByName('松鼠身体'),version=body.instanceMatrix.version,subject=effect.getObservationTarget();assert.ok(subject);const start=subject.position.clone();
    advance(effect,12.05,13,day,camera);assert.equal(body.instanceMatrix.version,version);const current=new THREE.Vector3();subject.focus(current);assert.ok(current.distanceTo(start)>.01);
    assert.ok(start.length()>1);subject.position.set(999,999,999);subject.focus(current);assert.ok(current.length()<100,'观察接口不能修改动物位置');
  }finally{effect.dispose();}
});

test('林鸟有完整飞落停栖再离开过程，树枝与栏杆都能落脚并跟随风摆',()=>{
  const effect=create();try{const visited=new Set();let fly=0,leave=false,last;
    for(let i=0;i<2400;i++){const t=i/20;effect.update(t,day);const body=pose(effect,'林鸟身体');
      if(body.size>.1){if(body.position.y>4.5)fly++;if(last)assert.ok(body.position.distanceTo(last)<.5);last=body.position;}else{if(visited.size)leave=true;last=null;}
      for(let j=0;j<effect.group.getObjectByName('林鸟身体').count;j++){const perched=pose(effect,'林鸟身体',j);const footCenter=new THREE.Vector3(0,-.1,.025).applyQuaternion(perched.rotation).multiplyScalar(perched.size).add(perched.position);if(perched.size>.1)for(const x of [0,6])if(Math.abs(footCenter.x-(x+Math.sin(t)*.05))<.002&&Math.abs(footCenter.y-4)<.002&&Math.abs(footCenter.z)<.002)visited.add(x);}}
    assert.ok(fly>20);assert.equal(visited.size,2);assert.ok(leave);
  }finally{effect.dispose();}
});

test('松鼠沿树干连续攀爬、暂停观察，偶尔贴地穿过山径后上另一棵树',()=>{
  const effect=create();try{let climbed=0,crossed=0,rest=0,last;
    for(let i=0;i<3600;i++){effect.update(i/20,day);const body=pose(effect,'松鼠身体');if(body.size<.1){last=null;continue;}
      const forward=new THREE.Vector3(0,0,1).applyQuaternion(body.rotation);
      if(forward.y>.7&&body.position.y>3)climbed++;
      if(body.position.x>1.2&&body.position.x<4.8&&Math.abs(body.position.y-(2+.13*body.size))<.01)crossed++;
      if(last){const delta=body.position.distanceTo(last);assert.ok(delta<.5,'爬树、落地、穿越和上树衔接不能跳位');if(delta<.004&&body.position.y>3)rest++;}last=body.position;
    }assert.ok(climbed>20);assert.ok(rest>20);assert.ok(crossed>20,'应偶尔穿过山径');
  }finally{effect.dispose();}
});

test('暴风雪和残雪期间退回休眠，转晴后错开恢复，隐藏树木不再被攀爬或停栖',()=>{
  let available=true;const habitats=habitat();for(const tree of habitats.trees)tree.available=()=>available;for(const perch of habitats.perches)perch.available=()=>available;
  const effect=create(habitats);try{
    advance(effect,0,12);assert.ok(pose(effect,'林鸟身体').size>.1);assert.ok(pose(effect,'松鼠身体').size>.1);
    effect.update(12.05,{...day,snow:1,weather:'blizzard'});assert.ok(pose(effect,'林鸟身体').size>.01);assert.ok(pose(effect,'松鼠身体').size>.01);
    advance(effect,12.1,28,{...day,snow:1,weather:'blizzard'});assert.ok(effect.group.children.every(group=>!group.visible));
    advance(effect,28.05,40,{...day,snowCover:.01});assert.ok(effect.group.children.every(group=>!group.visible));
    advance(effect,40.05,55);assert.ok(effect.group.children.every(group=>group.visible));
    available=false;advance(effect,55.05,72);assert.ok(effect.group.children.every(group=>!group.visible));
  }finally{effect.dispose();}
});

test('画质限量，镜头外跳过上传、转回立即刷新，资源去重释放且状态独立',()=>{
  const effect=create(),other=create(),empty=create({trees:[],perches:[],crossings:[]});try{
    const full=effect.group.getObjectByName('林鸟身体').count;effect.setQuality('low');assert.ok(effect.group.getObjectByName('林鸟身体').count<=full);effect.setQuality('high');
    other.update(0,day);const before=pose(other,'松鼠身体');advance(effect,0,12);assert.deepEqual(pose(other,'松鼠身体'),before);
    const camera=new THREE.PerspectiveCamera(60,1,.1,500);camera.position.set(3,5,12);camera.lookAt(3,4,0);effect.update(12.05,day,camera);
    camera.lookAt(3,5,30);effect.update(12.1,day,camera);const body=effect.group.getObjectByName('林鸟身体'),version=body.instanceMatrix.version;advance(effect,12.15,14,day,camera);assert.equal(body.instanceMatrix.version,version);assert.ok(effect.group.children.every(group=>!group.visible));
    camera.lookAt(3,4,0);effect.update(14.05,day,camera);assert.ok(body.instanceMatrix.version>version);
    advance(empty,0,20);assert.ok(empty.group.children.every(group=>!group.visible));
    const resources=new Set(),counts=new Map();effect.group.traverse(object=>{if(object.isInstancedMesh)resources.add(object);if(object.geometry)resources.add(object.geometry);if(object.material)resources.add(object.material);});for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
    effect.dispose();effect.dispose();const after=body.instanceMatrix.version;effect.update(30,day);effect.setQuality('low');assert.equal(body.instanceMatrix.version,after);assert.ok([...counts.values()].every(count=>count===1));
  }finally{effect.dispose();other.dispose();empty.dispose();}
});

test('穿越途中目的树被裁减时返回仍有效的源端，不再采样消失的树',()=>{
  const habitats=habitat(),flags=[true,true],invalidSamples=[0,0];
  habitats.trees.forEach((tree,i)=>{const sample=tree.sampleTrunk;tree.available=()=>flags[i];tree.sampleTrunk=function(...args){if(!flags[i])invalidSamples[i]++;return sample.apply(this,args);};});
  habitats.crossings[0].available=()=>flags.every(Boolean);
  const effect=create(habitats);let changed,previous,reversed=false;
  try {
    for(let step=0;step<3600;step++){
      const time=step/20;effect.update(time,day);const current=pose(effect,'松鼠身体');
      if(!changed&&current.size>.5&&current.position.x>1.3&&current.position.x<4.7&&Math.abs(current.position.y-(2+.13*current.size))<.005){
        const target=current.position.x>previous.position.x?1:0;flags[target]=false;changed={time,target,position:current.position.clone()};
      }else if(changed&&time<changed.time+1.2&&current.size>.3){
        const towardSource=changed.target===0?1:-1;
        if((current.position.x-changed.position.x)*towardSource>.15)reversed=true;
      }
      if(changed&&time>changed.time+4)break;previous=current;
    }
    assert.ok(changed,'需要实际启动一次穿越');assert.ok(reversed,'不能继续走向已消失的目的树');
    assert.deepEqual(invalidSamples,[0,0]);
  }finally{effect.dispose();}
});

test('宿主树消失后在最后位置短暂淡出，不沿不可见树干悬空下爬',()=>{
  const habitats=habitat(),flags=[true,true];let invalidSamples=0;
  habitats.trees.forEach((tree,i)=>{const sample=tree.sampleTrunk;tree.available=()=>flags[i];tree.sampleTrunk=function(...args){if(!flags[i])invalidSamples++;return sample.apply(this,args);};});
  const effect=create(habitats);let changed,hidden=false;
  try {
    for(let step=0;step<1200;step++){
      const time=step/20;effect.update(time,day);const current=pose(effect,'松鼠身体');
      if(!changed&&current.size>.5&&current.position.y>3.2){const source=Math.abs(current.position.x)<Math.abs(current.position.x-6)?0:1;flags[source]=false;changed={time,position:current.position.clone()};}
      else if(changed&&time<=changed.time+1){
        if(current.size>.01)assert.ok(current.position.distanceTo(changed.position)<.001,'宿主消失后保持最后接触位置淡出');else hidden=true;
      }
      if(changed&&time>changed.time+1)break;
    }
    assert.ok(changed&&hidden);assert.equal(invalidSamples,0);
  }finally{effect.dispose();}
});

test('落地和重新上树在树干外侧衔接，不能把身体中心穿过树根',()=>{
  const effect=create();let ground=0,last;
  try {
    for(let step=0;step<3600;step++){
      effect.update(step/20,day);const current=pose(effect,'松鼠身体');
      if(current.size>.5){
        if(last)assert.ok(current.position.distanceTo(last)<.5);
        if(Math.abs(current.position.y-(2+.13*current.size))<.005){
          const nearest=Math.min(Math.hypot(current.position.x,current.position.z),Math.hypot(current.position.x-6,current.position.z));
          assert.ok(nearest>.35,'横向身体必须站在树干基部外侧');ground++;
        }
        last=current.position;
      }else last=null;
    }
    assert.ok(ground>20);
  }finally{effect.dispose();}
});

test('停栖时真实双脚中点贴合落点，双脚沿枝条切向支撑',()=>{
  const anchor=new THREE.Vector3(0,4,0),branchTangent=new THREE.Vector3(1,.3,0).normalize();
  const perch={kind:'branch',available:()=>true,sample(time,target){return target.copy(anchor);},
    sampleFrame(time,target,normal,tangent){normal.set(-.3,1,0).normalize();tangent.copy(branchTangent);return target.copy(anchor);}};
  const effect=create({perches:[perch],trees:[],crossings:[]});let contacted=false;
  try {
    const mesh=effect.group.getObjectByName('林鸟身体'),position=mesh.geometry.attributes.position,matrix=new THREE.Matrix4();
    const feet=[];
    for(let i=0;i<position.count;i++)if(position.getY(i)<-.09999){const point=new THREE.Vector3().fromBufferAttribute(position,i);if(!feet.some(old=>old.distanceTo(point)<1e-6))feet.push(point);}
    assert.equal(feet.length,2);
    for(let step=0;step<800;step++){
      effect.update(step/20,day);const current=pose(effect,'林鸟身体');if(current.size<.7)continue;
      mesh.getMatrixAt(0,matrix);const a=feet[0].clone().applyMatrix4(matrix),b=feet[1].clone().applyMatrix4(matrix);
      if(a.clone().add(b).multiplyScalar(.5).distanceTo(anchor)<1e-5){
        assert.ok(a.clone().sub(b).normalize().cross(branchTangent).length()<1e-5);contacted=true;break;
      }
    }
    assert.ok(contacted,'不能仅让身体中心与落点保持固定世界Y高差');
  }finally{effect.dispose();}
});

test('林鸟偶尔选择同伴附近的独立落点结伴停留，保留落脚间距',()=>{
  let joined=0;
  for(const seed of [17,33,58,92]){
    let opened=false;
    const perches=Array.from({length:50},(_,i)=>({kind:'branch',available:()=>i===0||opened,
      sample(time,target){return target.set(i===0?0:i===1?1:100+i*10,4,0);}}));
    const effect=create({perches,trees:[],crossings:[],random:seededRandom(seed)});let established=false,found=false;
    try{
      for(let step=0;step<500;step++){
        effect.update(step/20,day);const positions=[];
        for(let i=0;i<10;i++){
          const body=pose(effect,'林鸟身体',i),feet=new THREE.Vector3(0,-.1,.025).applyQuaternion(body.rotation).multiplyScalar(body.size).add(body.position);
          if(body.size>.7&&Math.abs(feet.y-4)<.001)positions.push(feet);
        }
        if(!established&&positions.some(point=>Math.abs(point.x)<.01)){established=true;opened=true;}
        if(positions.some(point=>Math.abs(point.x)<.01)&&positions.some(point=>Math.abs(point.x-1)<.01))found=true;
        for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++)assert.ok(positions[i].distanceTo(positions[j])>.45,'不能挤占同一个停栖点');
      }
      if(found)joined++;
    }finally{effect.dispose();}
  }
  assert.ok(joined>=3,'有同伴时应偶尔倾向附近空落点，不能一直从整岛均匀抽选');
});
