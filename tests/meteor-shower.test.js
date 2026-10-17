import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const module=await import('../src/meteor-shower.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});
function create(options={groupRandom:()=>.5}){assert.ok(module?.createMeteorShower,'尚未加入成群流星雨');return module.createMeteorShower({timeRandom:()=>.25,...options});}
function camera(){const value=new THREE.PerspectiveCamera(54,1280/720,.5,7000);value.position.set(150,24,200);value.lookAt(0,65,0);value.updateMatrixWorld();return value;}
const count=shower=>shower.group.getObjectByName('meteor').geometry.drawRange.count/6;

test('即时流星跳过随机等待并接续下一轮，白天隐藏后晴夜立即恢复',()=>{
  const shower=create({groupRandom:()=>.5,timeRandom:()=>.99}),view=camera();
  try{
    shower.setMode('instant');shower.update(.1,1,view);assert.ok(count(shower)>0);
    let nextRound=false;
    for(let frame=1;frame<335;frame++){
      shower.update(.1,1,view);if(frame>=322)nextRound||=count(shower)>0;
    }
    assert.ok(nextRound,'即时模式不能保留默认的长随机等待');
    shower.update(.1,0,view);assert.equal(count(shower),0);
    shower.update(.1,1,view);assert.ok(count(shower)>0,'夜空恢复后无需再等几秒');
    shower.setMode('off');shower.update(.1,1,view);assert.equal(count(shower),0);
  }finally{shower.dispose();}
});

test('流星首次出现和各组等待由独立随机时间源决定',()=>{
  const view=camera(),first=[];
  for(const sample of [0,.99]){
    const shower=create({groupRandom:()=>.5,timeRandom:()=>sample});
    try{for(let i=0;i<300;i++){shower.update(.05,1,view);if(count(shower)){first.push(i*.05);break;}}}
    finally{shower.dispose();}
  }
  assert.equal(first.length,2);assert.ok(first[1]-first[0]>6,'刷新时的首轮时刻应能重新随机，不能重复同一固定序列');
  let draw=0;const samples=[.1,.2,.05,.95,.15,.85,.3,.7],starts=[];
  const shower=create({groupRandom:()=>.5,timeRandom:()=>samples[draw++%samples.length]});let previous=0;
  try{
    for(let i=0;i<700;i++){
      shower.update(.05,1,view);const index=shower.group.userData.burstIndex;
      if(index&&index!==previous){starts.push(i*.05);previous=index;}
    }
    const gaps=starts.slice(1).map((time,i)=>time-starts[i]);
    assert.ok(gaps.length>=3&&Math.max(...gaps)-Math.min(...gaps)>3,'组与组之间应有显著变化的随机停顿');
  }finally{shower.dispose();}
});

test('每组随机1至9颗且重新选择方向，同组错峰掠过，三种画质都保留完整数量',()=>{
  for(const quality of ['high','medium','low']){
    let draw=0;
    const shower=create({groupRandom:()=>{const index=Math.floor(draw/2);return draw++%2===0?(index%9+.1)/9:(index*.137)%1;}}),view=camera();
    shower.setQuality(quality);
    const heads=shower.group.getObjectByName('meteor-head').geometry,bursts=new Map(),heights=new Map();let peak=0;
    try{
      for(let frame=0;frame<2500;frame++){
        shower.update(.05,1,view);peak=Math.max(peak,count(shower));
        const {burstIndex,burstCount,burstDirection}=shower.group.userData;
        if(!burstIndex)continue;
        if(!bursts.has(burstIndex))bursts.set(burstIndex,{target:burstCount,direction:burstDirection,births:new Map()});
        const burst=bursts.get(burstIndex);
        assert.equal(burstDirection,burst.direction,'同一组飞行中不能改变方向');
        assert.ok(Math.sin(burstDirection)<-.5,'每组必须明显向下，排除向上和接近水平的方向');
        for(let j=0;j<heads.drawRange.count;j++){
          const size=heads.attributes.aSize.getX(j);if(!burst.births.has(size))burst.births.set(size,frame*.05);
          const key=`${burstIndex}:${size}`,height=new THREE.Vector3().fromBufferAttribute(heads.attributes.position,j).normalize().y;
          if(heights.has(key))assert.ok(height<heights.get(key),'每一颗实际轨迹也必须持续下降');heights.set(key,height);
        }
      }
      const firstNine=Array.from(bursts.values()).slice(0,9);
      assert.equal(firstNine.length,9);
      for(let i=0;i<9;i++){
        const burst=firstNine[i];assert.equal(burst.target,i+1,'随机范围应包含1颗和9颗');
        assert.equal(burst.births.size,i+1,'各画质都应生成本组抽中的全部流星');
        const times=Array.from(burst.births.values());for(let j=1;j<times.length;j++)assert.ok(times[j]>times[j-1],'同组流星应错峰出现');
      }
      assert.equal(new Set(firstNine.map(burst=>burst.direction)).size,9,'每组应重新抽取方向');
      assert.equal(peak,9,'最多一组9颗，避免额外重叠刷屏');
    }finally{shower.dispose();}
  }
});

test('晴夜数秒内开始流星雨，高潮同时出现多条轨迹，结束后留出安静间隔',()=>{
  const shower=create(),view=camera();let peak=0,visibleFrames=0,first=Infinity,last=0;
  try{
    for(let frame=0;frame<=1200;frame++){
      const time=frame*.05;shower.update(.05,1,view,{pixelRatio:1});const amount=count(shower);
      if(amount){first=Math.min(first,time);last=time;visibleFrames++;}peak=Math.max(peak,amount);
    }
    assert.ok(first>=2&&first<=6,`首次出现 ${first}`);
    assert.ok(peak===5,`调稀后的高潮数量 ${peak}`);
    assert.ok(visibleFrames>180&&visibleFrames<500);
    assert.ok(last>30&&last<38,'延长的流星雨需正常收尾而非无限刷屏');
    assert.equal(count(shower),0);
  }finally{shower.dispose();}
});

test('流星整体同向、比例较小，资源在整轮事件与低画质中复用',()=>{
  const shower=create(),view=camera();const trail=shower.group.getObjectByName('meteor'),head=shower.group.getObjectByName('meteor-head');
  const geometry=trail.geometry,headGeometry=head.geometry;let checked=false,peak=0;
  try{
    for(let i=0;i<400;i++){
      shower.update(.05,1,view,{pixelRatio:1});peak=Math.max(peak,count(shower));
      const p=geometry.attributes.position;
      if(count(shower)>=3&&geometry.attributes.aOpacity.getX(0)>.2){
        assert.ok(p.array.every(Number.isFinite));
        const a=new THREE.Vector3().fromBufferAttribute(p,0),b=new THREE.Vector3().fromBufferAttribute(p,1);
        assert.ok(a.distanceTo(b)/a.length()>.003,'软化前的尾迹宽度不能窄到完全亚像素');
        const headPoint=a.clone().add(b).normalize();
        const tailPoint=new THREE.Vector3().fromBufferAttribute(p,2).add(new THREE.Vector3().fromBufferAttribute(p,3)).normalize();
        assert.ok(headPoint.y>.26&&tailPoint.y>.26,'整条流星轨迹应保持在高于海平线的天空中');
        assert.ok(a.distanceTo(b)/a.length()<.012,'尾迹宽度应缩小，避免显得过近');
        const tipWidth=new THREE.Vector3().fromBufferAttribute(p,2).distanceTo(new THREE.Vector3().fromBufferAttribute(p,3));
        assert.ok(tipWidth<a.distanceTo(b)*.5,'尾迹末端应比亮头处更细');
        let commonDirection;
        for(let j=0;j<count(shower);j++){
          if(geometry.attributes.aOpacity.getX(j*4)<.2)continue;
          const h=new THREE.Vector3().fromBufferAttribute(p,j*4).add(new THREE.Vector3().fromBufferAttribute(p,j*4+1)).multiplyScalar(.5);
          const t=new THREE.Vector3().fromBufferAttribute(p,j*4+2).add(new THREE.Vector3().fromBufferAttribute(p,j*4+3)).multiplyScalar(.5);
          h.add(view.position).project(view);t.add(view.position).project(view);
          const movement=new THREE.Vector2(h.x-t.x,h.y-t.y).normalize();
          if(commonDirection)assert.ok(commonDirection.dot(movement)>.8,'同组轨迹应保持大致一致的方向');else commonDirection=movement;
        }
        for(let j=0;j<headGeometry.drawRange.count;j++)assert.ok(headGeometry.attributes.aSize.getX(j)<=20,'参考图中的亮核应小而集中，避免大光球');
        checked=true;
      }
    }
    assert.ok(checked&&peak===5);
    const fixed=geometry.attributes.position.array.slice();view.lookAt(500,100,100);view.updateMatrixWorld();shower.update(0,1,view);
    assert.deepEqual(geometry.attributes.position.array,fixed,'转头不能改变已出现流星的世界方向');
    shower.setQuality('low');
    for(let i=0;i<100;i++){shower.update(.05,1,view,{pixelRatio:.8});assert.ok(count(shower)<=6);}
    assert.equal(trail.geometry,geometry);assert.equal(head.geometry,headGeometry);
  }finally{shower.dispose();}
});

test('流畅画质仍有成群高潮，同时限制并发轨迹数量',()=>{
  const shower=create(),view=camera();let peak=0;shower.setQuality('low');
  try{for(let i=0;i<500;i++){shower.update(.05,1,view);peak=Math.max(peak,count(shower));}assert.ok(peak===5);}
  finally{shower.dispose();}
});

test('同一轮中细小流星掠过更快，较大的流星较慢，速度差异随个体保持',()=>{
  const shower=create(),view=camera();view.lookAt(0,2000,-200);view.updateMatrixWorld();
  const geometry=shower.group.getObjectByName('meteor-head').geometry;
  const previous=new Map(),samples=new Map();
  try{
    for(let frame=0;frame<640;frame++){
      shower.update(.05,1,view);const current=new Map();
      for(let i=0;i<geometry.drawRange.count;i++){
        const size=geometry.attributes.aSize.getX(i),point=new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i).normalize();
        const before=previous.get(size);
        if(before){
          const speeds=samples.get(size)??[];speeds.push(before.angleTo(point)/.05);samples.set(size,speeds);
        }
        current.set(size,point);
      }
      previous.clear();for(const [size,point]of current)previous.set(size,point);
    }
    const individuals=Array.from(samples,([size,speeds])=>({size,speed:speeds.reduce((a,b)=>a+b,0)/speeds.length})).sort((a,b)=>a.size-b.size);
    assert.ok(individuals.length>=20,'应取样足够多个体，而非偶然的一对');
    const n=Math.floor(individuals.length/3),average=items=>items.reduce((sum,item)=>sum+item.speed,0)/items.length;
    assert.ok(average(individuals.slice(-n))<average(individuals.slice(0,n))*.85,'较大的流星应具有明显较慢的角速度');
  }finally{shower.dispose();}
});

test('Google式流星保持白亮淡金，短促掠过后迅速淡出余迹',()=>{
  const shower=create(),view=camera();let brightSpan=0;
  const heads=shower.group.getObjectByName('meteor-head'),trails=shower.group.getObjectByName('meteor');
  try{
    for(let i=0;i<160&&heads.geometry.drawRange.count===0;i++)shower.update(.05,1,view);
    assert.equal(heads.geometry.drawRange.count,1);
    for(let i=0;i<36;i++){
      shower.update(.05,.1,view);
      if(heads.geometry.drawRange.count>0){
        brightSpan+=.05;const colors=heads.geometry.attributes.aColor;
        assert.ok(colors.getY(0)>.94&&colors.getZ(0)>.8,'全程保持白亮淡金色，不再明显转橙');
        const trailColor=trails.geometry.attributes.aColor;
        assert.ok(Math.abs(trailColor.getZ(0)-colors.getZ(0))<1e-6,'头尾颜色保持一致');
      }
    }
    assert.ok(brightSpan>.6&&brightSpan<1.4,'掠过应短促利落，同时可清楚辨认');
    assert.equal(trails.geometry.drawRange.count,0,'停止出生两秒内应完全淡出，避免尾迹长时间悬停');
  }finally{shower.dispose();}
});

test('白天隐藏并清理正在发生的流星雨，离开后所有资源恰好释放一次',()=>{
  const shower=create(),view=camera(),resources=new Set();
  shower.group.traverse(object=>{if(object.geometry)resources.add(object.geometry);if(object.material)resources.add(object.material);});
  let releases=0;resources.forEach(value=>value.addEventListener('dispose',()=>releases++));
  for(let i=0;i<300&&count(shower)===0;i++)shower.update(.05,1,view);
  assert.ok(count(shower)>0);
  shower.update(.1,0,view);assert.equal(count(shower),0);assert.equal(shower.group.visible,false);
  shower.dispose();shower.dispose();assert.equal(releases,resources.size);
});
