import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAtmosphere} from '../src/atmosphere.js';
import {createSimulation,getEnvironment} from '../src/simulation.js';

const sky = await import('../src/night-sky.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
});
const camera = () => {
  const value = new THREE.PerspectiveCamera(55, 1.6, .5, 7000);
  value.position.set(150, 24, 200); value.lookAt(0, 160, 0); value.updateMatrixWorld();
  return value;
};
const clear = {hour:22, season:'summer', daylight:0, cloudiness:0, skyCloudCover:0, fog:0, moonLight:0, moonIllumination:0};
function create(options) { assert.ok(sky?.createNightSky, '缺少真实星位与夜空效果模块'); return sky.createNightSky({meteorRandom:()=>.5,eventRandom:()=>.25,...options}); }

test('星座、流星和彗星可独立开关，关闭立即清理，重新开启后恢复随机调度',()=>{
  const night=create({cometRandom:()=>0,eventRandom:()=>0}),view=camera();
  const meteor=night.group.getObjectByName('meteor'),comet=night.group.getObjectByName('comet'),head=night.group.getObjectByName('comet-head');
  const meteorGeometry=meteor.geometry,cometGeometry=comet.geometry;let time=0;
  try{
    for(;time<30;time+=.1){night.update(time,clear,view);if(meteor.visible&&comet.visible)break;}
    assert.ok(meteor.visible&&comet.visible,'默认流星和彗星均开启');
    night.setMeteorsVisible(false);
    assert.equal(meteor.visible,false);assert.equal(meteor.geometry.drawRange.count,0);
    assert.equal(comet.visible,true,'关闭流星不影响彗星');
    night.setConstellationsVisible(true);night.update(time+.1,clear,view);
    assert.equal(night.group.getObjectByName('constellation-guides').visible,true);
    night.setCometsVisible(false);assert.equal(comet.visible,false);assert.equal(head.visible,false);
    night.setConstellationsVisible(false);
    for(let i=0;i<1000;i++){time+=.1;night.update(time,clear,view);assert.equal(meteor.visible,false);assert.equal(comet.visible,false);}
    night.setMeteorsVisible(true);let sawMeteor=false;
    for(let i=0;i<120;i++){time+=.1;night.update(time,clear,view);sawMeteor||=meteor.visible;assert.equal(comet.visible,false);}
    assert.ok(sawMeteor,'重新开启流星后应恢复调度');
    night.setCometsVisible(true);let sawComet=false;
    for(let i=0;i<920;i++){time+=.1;night.update(time,clear,view);sawComet||=comet.visible;}
    assert.ok(sawComet,'重新开启彗星后应恢复调度');
    assert.equal(meteor.geometry,meteorGeometry);assert.equal(comet.geometry,cometGeometry);
  }finally{night.dispose();}
});

test('天象三种模式支持即时触发、不出现及恢复默认随机等待',()=>{
  const night=create({eventRandom:()=>.9,cometRandom:()=>0}),view=camera();let time=0;
  const meteor=night.group.getObjectByName('meteor'),comet=night.group.getObjectByName('comet');
  try{
    night.update(time,clear,view);
    night.setMeteorMode('instant');night.setCometMode('instant');
    for(let i=0;i<3;i++){time+=.1;night.update(time,clear,view);}
    assert.ok(meteor.visible&&comet.visible,'即时模式应在数帧内出现，不等待默认随机计时');
    night.setMeteorMode('off');assert.equal(meteor.visible,false);assert.equal(comet.visible,true);
    night.setCometMode('off');assert.equal(comet.visible,false);
    for(let i=0;i<1000;i++){time+=.1;night.update(time,clear,view);assert.equal(meteor.visible,false);assert.equal(comet.visible,false);}
    night.setMeteorMode('default');night.setCometMode('default');
    for(let i=0;i<20;i++){time+=.1;night.update(time,clear,view);assert.equal(meteor.visible,false);assert.equal(comet.visible,false);}
    let sawMeteor=false,sawComet=false;
    for(let i=0;i<950;i++){time+=.1;night.update(time,clear,view);sawMeteor||=meteor.visible;sawComet||=comet.visible;}
    assert.ok(sawMeteor&&sawComet,'默认模式仍按随机时间出现');
  }finally{night.dispose();}
});

test('即时模式连续接续彗星事件，白天仍隐藏、夜晚立刻恢复，返回默认后不补播',()=>{
  const night=create({eventRandom:()=>.9,cometRandom:()=>0}),view=camera();let time=0;
  const comet=night.group.getObjectByName('comet');
  try{
    night.setCometMode('instant');night.update(time,clear,view);assert.ok(comet.visible);
    let ended=false,resumed=false;
    for(let i=0;i<1700;i++){
      time+=.1;night.update(time,clear,view);
      if(!comet.visible)ended=true;else if(ended){resumed=true;break;}
    }
    assert.ok(resumed,'即时模式应接着开始下一轮，不等待40至240秒');
    night.update(time+.1,{...clear,daylight:1},view);assert.equal(comet.visible,false);
    time+=50;night.update(time,clear,view);assert.ok(comet.visible,'晴夜恢复时即时模式应可见');
    night.setCometMode('default');time+=.1;night.update(time,clear,view);assert.equal(comet.visible,false);
  }finally{night.dispose();}
});

test('青白彗星进一步提速，三秒移动超过约3.4度且保持匀速',()=>{
  const night=create({cometRandom:()=>0}),view=camera();let time=0;
  try{
    night.setCometMode('instant');night.update(time,clear,view);
    const p=night.group.getObjectByName('comet-head').geometry.attributes.position;
    const a=new THREE.Vector3().fromBufferAttribute(p,0),positions=[];
    for(let frame=1;frame<=60;frame++){
      time+=.1;night.update(time,clear,view);
      if(frame%30===0)positions.push(new THREE.Vector3().fromBufferAttribute(p,0));
    }
    const first=a.angleTo(positions[0]),second=positions[0].angleTo(positions[1]);
    assert.ok(first>.06&&first<.09,'提速后应有更明显的位移');
    assert.ok(Math.abs(first-second)<1e-5,'持续飞行仍应匀速');
  }finally{night.dispose();}
});

test('彗星出现时刻重新随机，并持续移动到整个彗星离开可见视野',()=>{
  const first=[];
  for(const sample of [0,.9]){
    const night=create({cometRandom:()=>0,eventRandom:()=>sample}),view=camera();
    try{for(let frame=0;frame<1000;frame++){night.update(frame*.1,clear,view);if(night.group.getObjectByName('comet').visible){first.push(frame*.1);break;}}}
    finally{night.dispose();}
  }
  assert.equal(first.length,2);assert.ok(first[1]-first[0]>50,'彗星首轮时刻应由新的随机等待决定');
  const night=create({cometRandom:()=>0}),view=camera();view.fov=90;view.updateProjectionMatrix();
  try{
    const comet=night.group.getObjectByName('comet'),head=night.group.getObjectByName('comet-head');let start=0;
    for(;start<100;start+=.1){night.update(start,clear,view);if(comet.visible)break;}
    let previous;
    for(let i=1;i<=240;i++){
      night.update(start+i*.1,clear,view);
      if(i===200)previous=new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0);
    }
    assert.ok(comet.visible&&comet.material.uniforms.uOpacity.value>.75,'仍在画面中时不能按原先12至20秒的时长淡出');
    const after=new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0);
    assert.ok(previous.angleTo(after)>.05,'原先定时终点之后必须继续移动，不能停在原地');
    let end=start+24;
    for(let i=1;i<2000&&comet.visible;i++){end=start+24+i*.1;night.update(end,clear,view);}
    assert.equal(comet.visible,false,'飞出后应结束本次事件');
    view.updateMatrixWorld();
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse));
    const bounds=new THREE.Box3().setFromBufferAttribute(comet.geometry.attributes.position).translate(view.position);
    assert.ok(!frustum.intersectsBox(bounds)||bounds.max.y<view.position.y+2070*.12,'完整尾迹离开画面或被地平线遮住后才能结束');
  }finally{night.dispose();}
});

test('星座指引包含参考图全部十二星座，每种只有一套完整连线',()=>{
  const night=create();
  try{
    const group=night.group.getObjectByName('constellation-guides');
    for(const name of ['白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座','水瓶座','双鱼座']){
      const lines=group.children.filter(object=>object.isLineSegments&&object.name===name);
      assert.equal(lines.length,1,`${name}应有且仅有一套连线`);
      assert.ok(lines[0].geometry.attributes.position.count>=4,`${name}应有完整骨架`);
    }
  }finally{night.dispose();}
});

test('星座三态默认隐藏、只显示连线亮星、连线与名称同显，并复用名称资源',()=>{
  const original=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({strokeText(){},fillText(){}})})};
  const night=create(),view=camera();
  try{
    const guides=night.group.getObjectByName('constellation-guides');
    assert.equal(guides.visible,false);assert.equal(guides.children.filter(obj=>obj.isSprite).length,0);
    night.setConstellationMode('lines');night.update(0,clear,view);
    assert.ok(guides.visible);assert.equal(guides.children.filter(obj=>obj.isSprite).length,0,'只开连线时不应创建名称纹理');
    night.setConstellationMode('labels');night.update(.1,clear,view);
    const labels=guides.children.filter(obj=>obj.isSprite),textures=labels.map(label=>label.material.map);
    assert.equal(labels.length,17);assert.ok(labels.some(label=>label.visible));
    night.setConstellationMode('lines');night.update(.2,clear,view);
    assert.ok(guides.visible);assert.ok(labels.every(label=>!label.visible));
    night.setConstellationMode('off');night.update(.3,clear,view);assert.equal(guides.visible,false);
    night.setConstellationMode('labels');night.update(.4,clear,view);
    assert.deepEqual(labels.map(label=>label.material.map),textures);
  }finally{night.dispose();globalThis.document=original;}
});

test('星座指引可开关，连线端点落在真实恒星上，天气显隐随夜空变化',()=>{
  const night=create(),view=camera();
  try{
    assert.equal(typeof night.setConstellationsVisible,'function');
    night.update(0,clear,view);
    const stars=night.group.getObjectByName('catalogue-stars'),geometry=stars.geometry;
    const guides=night.group.getObjectByName('constellation-guides');assert.equal(guides.visible,false);
    night.setConstellationsVisible(true);night.update(1,clear,view);assert.equal(guides.visible,true);
    const dipper=guides.getObjectByName('北斗七星');assert.ok(dipper);
    const position=new THREE.Vector3().fromBufferAttribute(dipper.geometry.attributes.position,0).normalize();
    const starIndex=night.catalogue.findIndex(row=>row[0]===4301);
    const actual=new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,starIndex).normalize();
    assert.ok(position.angleTo(actual)<1e-6);
    night.setConstellationsVisible(false);assert.equal(guides.visible,false);assert.equal(stars.geometry,geometry);
    night.setConstellationsVisible(true);night.update(2,{...clear,daylight:1},view);assert.equal(guides.visible,false);
  }finally{night.dispose();}
});

test('星座指引使用明亮白线，全部连线恒星获得更亮的光点，低画质也完整保留',()=>{
  const night=create(),view=camera();
  try{
    night.setConstellationsVisible(true);night.update(0,clear,view);
    const guides=night.group.getObjectByName('constellation-guides'),nodes=guides.getObjectByName('constellation-nodes');
    assert.ok(nodes?.isPoints,'所有被连接恒星需要统一的亮点增强');
    const endpoints=new Set();
    for(const lines of guides.children.filter(item=>item.isLineSegments)){
      const color=lines.material.uniforms.uColor.value;
      assert.ok(color.r>.95&&color.g>.95&&color.b>.95,'连线应呈亮白色');
      assert.ok(lines.material.uniforms.uOpacity.value>.6,'连线亮度应明显提高');
      const p=lines.geometry.attributes.position;for(let i=0;i<p.count;i++)endpoints.add([p.getX(i),p.getY(i),p.getZ(i)].join(','));
    }
    const p=nodes.geometry.attributes.position;
    assert.equal(p.count,endpoints.size,'共享恒星只增强一次，避免重复叠加光点');
    for(let i=0;i<p.count;i++)assert.ok(endpoints.has([p.getX(i),p.getY(i),p.getZ(i)].join(',')),'增强光点必须与连线端点重合');
    assert.ok(nodes.material.uniforms.uOpacity.value>1,'连接星应有高于普通背景星的光核强度');
    const geometry=nodes.geometry;night.setQuality('low');night.update(1,clear,view);
    assert.equal(nodes.geometry,geometry);assert.equal(nodes.geometry.attributes.position.count,endpoints.size);
    night.setConstellationsVisible(false);assert.equal(guides.visible,false);
    night.setConstellationsVisible(true);night.update(2,{...clear,fog:1},view);assert.equal(guides.visible,false);
  }finally{night.dispose();}
});

test('真实亮星维持星座相对位置，稳定星与闪烁星同时存在，天空随视点平移而不跟随转头', () => {
  const night = create(), view = camera();
  try {
    night.update(0, clear, view);
    const stars = night.group.getObjectByName('catalogue-stars');
    const positions = stars.geometry.getAttribute('position');
    const twinkle = stars.geometry.getAttribute('aTwinkle');
    assert.ok(positions.count > 3000);
    const amount = Array.from(twinkle.array).filter(value => value > 0).length;
    assert.ok(amount > positions.count * .12 && amount < positions.count * .45);
    const byId = new Map(night.catalogue.map((row,i) => [row[0],i]));
    const a = new THREE.Vector3().fromBufferAttribute(positions,byId.get(4301)).normalize();
    const b = new THREE.Vector3().fromBufferAttribute(positions,byId.get(4295)).normalize();
    // 北斗天枢与天璇约相距5.37度；随机生成星位或错误赤纬符号会破坏这一形状。
    assert.ok(Math.abs(THREE.MathUtils.radToDeg(a.angleTo(b))-5.37)<.05);
    const rotation = stars.parent.quaternion.clone();
    view.position.set(-20, 120, 40); view.lookAt(0,200,200); view.updateMatrixWorld();
    night.update(1, clear, view);
    assert.deepEqual(night.group.position.toArray(),view.position.toArray());
    assert.ok(rotation.angleTo(stars.parent.quaternion)<1e-7);
    night.update(2,{...clear,hour:2},view);
    assert.ok(rotation.angleTo(stars.parent.quaternion)>.5);
  } finally {night.dispose();}
});

test('白天和浓雾关闭全部天象，月光削弱银河，天气及画质切换不重建资源', () => {
  const night = create(), view = camera();
  try {
    night.update(0,clear,view);
    const stars=night.group.getObjectByName('catalogue-stars'),band=night.group.getObjectByName('milky-way');
    const geometry=stars.geometry,material=band.material;
    const dark=material.uniforms.uOpacity.value;
    assert.ok(dark>0);
    night.update(1,{...clear,moonLight:1,moonIllumination:1},view);
    assert.ok(material.uniforms.uOpacity.value<dark*.4);
    for(const env of [{...clear,daylight:1},{...clear,fog:1},{...clear,cloudiness:1}]){
      night.update(2,env,view); assert.equal(night.group.visible,false);
    }
    night.setQuality('low'); night.update(3,clear,view);
    assert.ok(stars.geometry.drawRange.count<geometry.getAttribute('position').count);
    assert.equal(stars.geometry,geometry); assert.equal(band.material,material);
    night.setQuality('high');
    assert.equal(stars.geometry.drawRange.count,geometry.getAttribute('position').count);
  } finally {night.dispose();}
});

test('三种彗星沿明显斜线下行，尾巴向后斜上方延伸，避开竖直和水平',()=>{
  for(const sample of [0,.45,.9]){
    const night=create({cometRandom:()=>sample,eventRandom:()=>0}),view=camera();
    try{
      const comet=night.group.getObjectByName('comet'),head=night.group.getObjectByName('comet-head');let time=0;
      for(;time<30;time+=.1){night.update(time,clear,view);if(comet.visible)break;}
      const start=new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0).normalize();
      for(let i=1;i<=30;i++)night.update(time+i*.1,clear,view);
      const end=new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0).normalize();
      const east=new THREE.Vector3(-start.z,0,start.x).normalize(),up=new THREE.Vector3().crossVectors(east,start).normalize();
      if(up.y<0)up.negate();
      const travel=end.clone().sub(start),angle=Math.atan2(-travel.dot(up),Math.abs(travel.dot(east)))*180/Math.PI;
      assert.ok(angle>=30&&angle<=62,`下行倾角 ${angle.toFixed(1)}° 应避开水平和竖直`);
      const p=comet.geometry.attributes.position;
      const tail=new THREE.Vector3().fromBufferAttribute(p,2).add(new THREE.Vector3().fromBufferAttribute(p,3)).multiplyScalar(.5).normalize();
      const behind=tail.sub(end),tailAngle=Math.atan2(behind.dot(up),Math.abs(behind.dot(east)))*180/Math.PI;
      assert.ok(tailAngle>=25&&tailAngle<=68,`尾巴倾角 ${tailAngle.toFixed(1)}° 应斜向后上方`);
      assert.ok(behind.normalize().dot(travel.normalize())<-.8,'尾巴应整体向飞行方向的后方展开');
    }finally{night.dispose();}
  }
});

test('扫把星具有清晰长尾和宽扇面，三秒内可察觉明显位移，转头不改变轨迹',()=>{
  const night=create(),view=camera();
  try{
    const comet=night.group.getObjectByName('comet'),head=night.group.getObjectByName('comet-head');
    let time=0;
    for(;time<65;time+=.1){night.update(time,clear,view);if(comet.visible&&comet.material.uniforms.uOpacity.value>.75)break;}
    assert.ok(comet.visible&&time<65);
    const p=comet.geometry.attributes.position;
    const near=new THREE.Vector3().fromBufferAttribute(p,0).add(new THREE.Vector3().fromBufferAttribute(p,1)).multiplyScalar(.5);
    const far=new THREE.Vector3().fromBufferAttribute(p,2).add(new THREE.Vector3().fromBufferAttribute(p,3)).multiplyScalar(.5);
    assert.ok(near.angleTo(far)>.30,'长尾应占据明显天区，而不是一条小光丝');
    const fanWidth=new THREE.Vector3().fromBufferAttribute(p,2).distanceTo(new THREE.Vector3().fromBufferAttribute(p,3))/far.length();
    assert.ok(fanWidth>.12&&fanWidth<.25,'尾部应展开为宽扇形，且保留远空比例');
    assert.ok(head.material.uniforms.uSize.value>=40,'彗头需要可辨认的彗发光晕');
    const start=new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0).normalize();
    for(let i=1;i<=30;i++)night.update(time+i*.1,clear,view);
    const end=new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0).normalize();
    assert.ok(start.angleTo(end)>.025&&start.angleTo(end)<.17,'提速后三秒内应看出明显移动，同时区别于快速流星');
    const fixed=comet.geometry.attributes.position.array.slice();
    view.lookAt(1000,200,500);view.updateMatrixWorld();night.update(time+3,clear,view);
    assert.deepEqual(comet.geometry.attributes.position.array,fixed,'彗星应固定在世界天空中，不能随转头跳动');
  }finally{night.dispose();}
});

test('正常调度随机出现三种彗星，每轮保持外观，方向和速度各不相同并复用资源',()=>{
  const draws=[0,.45,.9];let draw=0;
  const night=create({cometRandom:()=>draws[draw++%draws.length]}),view=camera();
  const comet=night.group.getObjectByName('comet'),head=night.group.getObjectByName('comet-head');
  const geometry=comet.geometry,material=comet.material,episodes=[];let wasVisible=false,current;
  try{
    for(let frame=0;frame<6500&&episodes.length<3;frame++){
      const time=frame*.25;night.update(time,clear,view);
      if(comet.visible&&!wasVisible){
        assert.ok(['icy','golden','emerald'].includes(comet.userData.variant),'每次事件需要选择一种有效彗星');
        current={id:comet.userData.variant,time,points:[],start:new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0).normalize()};
        assert.ok(current.start.y>.72,'三种彗星都应从较高天区出现');
        current.color=material.uniforms.uDustColor.value.toArray();
      }
      if(comet.visible){
        assert.equal(comet.userData.variant,current.id,'飞行途中不能随机变成另一种彗星');
        current.end=new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0).normalize();

        if(time-current.time<=3.01)current.points.push(new THREE.Vector3().fromBufferAttribute(head.geometry.attributes.position,0).normalize());
      }
      if(!comet.visible&&wasVisible){
        const a=current.points[0],b=current.points.at(-1);
        current.distance=a.angleTo(b);current.direction=b.clone().sub(a).normalize();current.duration=time-current.time;episodes.push(current);
      }
      wasVisible=comet.visible;
    }
    assert.equal(episodes.length,3,'正常事件调度需能连续出现三种彗星');
    assert.equal(new Set(episodes.map(item=>item.id)).size,3);
    assert.equal(new Set(episodes.map(item=>item.color.join(','))).size,3,'三种尾巴应具有不同颜色');
    assert.ok(episodes.every(item=>item.start.y-item.end.y>.025),'三种彗星都应从高处向下移动');
    assert.ok(episodes.every(item=>item.duration>22),'彗星应超过原先定时时长继续移动，直到离开视野');
    for(const [index,minimum]of [[0,.04],[1,.025],[2,.07]])assert.ok(episodes[index].distance>minimum,'三种彗星三秒内都应有明显的位移');
    assert.ok(episodes[2].distance>episodes[0].distance*1.2&&episodes[0].distance>episodes[1].distance*1.2,'蓝绿双尾更快、青白居中、暖金更慢');
    for(let i=0;i<3;i++)for(let j=0;j<i;j++)assert.ok(episodes[i].direction.dot(episodes[j].direction)<.98,'收窄斜向角度后，三种彗星仍应保留可分辨的不同方向');
    assert.equal(comet.geometry,geometry);assert.equal(comet.material,material);
  }finally{night.dispose();}
});

test('彗星持续下降穿越地平线渐隐区域时，尾迹连续移动而不突然伸长',()=>{
  const night=create({eventRandom:()=>0,cometRandom:()=>0}),view=camera();
  const angle=THREE.MathUtils.degToRad(202.5);
  view.lookAt(view.position.clone().add(new THREE.Vector3(Math.cos(angle),0,Math.sin(angle))));view.updateMatrixWorld();
  const env=getEnvironment(createSimulation({hour:5.75,windSeed:1}));
  let previous,checked=0;
  try{
    for(let frame=0;frame<900;frame++){
      night.update(frame*.1,env,view);
      const comet=night.group.getObjectByName('comet');if(!comet.visible)continue;
      const head=new THREE.Vector3().fromBufferAttribute(night.group.getObjectByName('comet-head').geometry.attributes.position,0);
      const p=comet.geometry.attributes.position;
      const tail=new THREE.Vector3().fromBufferAttribute(p,2).add(new THREE.Vector3().fromBufferAttribute(p,3)).multiplyScalar(.5);
      const height=head.clone().normalize().y;
      if(previous&&height>.16&&height<.35){assert.ok(previous.angleTo(tail)<.01,'尾端不能在高度门限处单帧跳变');checked++;}
      previous=tail;
      view.lookAt(head.add(view.position));view.updateMatrixWorld();
    }
    assert.ok(checked>50,'应覆盖尾长限制与地平线渐隐之间的完整过渡');
  }finally{night.dispose();}
});

test('接近黎明且水平看远海时，长彗尾也保持在高空，不能伸入海面',()=>{
  const night=create(),view=camera(),point=new THREE.Vector3();
  const angle=THREE.MathUtils.degToRad(135);
  view.lookAt(view.position.clone().add(new THREE.Vector3(Math.cos(angle),0,Math.sin(angle))));view.updateMatrixWorld();
  const env={...clear,hour:5.75,sunDirection:new THREE.Vector3(1,-.065,-.35).normalize()};let checked=0;
  try{
    for(let frame=0;frame<1250;frame++){
      night.update(frame*.1,env,view);const comet=night.group.getObjectByName('comet');
      if(!comet.visible)continue;
      const positions=comet.geometry.attributes.position;
      const head=night.group.getObjectByName('comet-head'),height=point.fromBufferAttribute(head.geometry.attributes.position,0).normalize().y;
      if(height>.32)for(let i=0;i<positions.count;i++)assert.ok(point.fromBufferAttribute(positions,i).normalize().y>.15,'高空阶段的彗尾绘制面不能伸入海面');
      if(height<=0)assert.equal(head.material.uniforms.uOpacity.value,0,'彗头进入地平线后不应仍然发光');
      checked++;
    }
    assert.ok(checked>100);
  }finally{night.dispose();}
});

test('流星雨成群出现且有间隔，彗星缓慢且少见；16倍速不压缩事件间隔，停止后释放所有资源', () => {
  const normal=create({cometRandom:()=>0}),fast=create({cometRandom:()=>0}),view=camera();
  const resources=new Set(); normal.group.traverse(item=>{if(item.geometry)resources.add(item.geometry);if(item.material)resources.add(item.material);});
  let released=0;resources.forEach(item=>item.addEventListener('dispose',()=>released++));
  let meteorFrames=0,cometFrames=0,rises=0,last=false,peakCount=0;
  try {
    for(let frame=0;frame<=1200;frame++){
      const time=frame*.1; normal.update(time,clear,view);fast.update(time*16,{...clear,animationRate:16},view);
      const a=normal.group.getObjectByName('meteor'),b=fast.group.getObjectByName('meteor');
      const comet=normal.group.getObjectByName('comet');
      assert.equal(a.visible,b.visible);
      assert.equal(comet.visible,fast.group.getObjectByName('comet').visible);
      if(a.visible){meteorFrames++;if(!last)rises++;peakCount=Math.max(peakCount,a.geometry.drawRange.count/6);assert.ok(a.geometry.getAttribute('position').array.every(Number.isFinite));}
      if(comet.visible){
        cometFrames++;
        const head=new THREE.Vector3().fromBufferAttribute(normal.group.getObjectByName('comet-head').geometry.attributes.position,0).normalize();
        assert.ok(head.y>0||normal.group.getObjectByName('comet-head').material.uniforms.uOpacity.value===0,'彗头低于地平线时必须隐藏，避免出现在海面');
      }
      last=a.visible;
    }
    assert.ok(rises>=10&&rises<=22);
    assert.ok(meteorFrames>180&&meteorFrames<500);
    assert.ok(peakCount===5);
    assert.ok(cometFrames>200&&cometFrames<1100);
    normal.update(121,{...clear,daylight:1},view);
    assert.equal(normal.group.visible,false);
  } finally {normal.dispose();fast.dispose();}
  assert.equal(released,resources.size);normal.dispose();assert.equal(released,resources.size);
});

test('海岛大气驱动夜空显隐与画质，并在退出时释放夜空资源',()=>{
  const previous={document:globalThis.document,width:globalThis.innerWidth,height:globalThis.innerHeight};
  const context=new Proxy({
    createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
    createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}}),
  },{get:(object,key)=>object[key]??(()=>{}),set:(object,key,value)=>{object[key]=value;return true;}});
  globalThis.document={createElement:()=>({getContext:()=>context})};globalThis.innerWidth=1000;globalThis.innerHeight=700;
  const scene=new THREE.Scene(),view=camera();let atmosphere;
  try{
    atmosphere=createAtmosphere(scene,{moonMap:new THREE.Texture()});
    const group=atmosphere.group.getObjectByName('night-sky');assert.ok(group,'海岛仍使用旧随机星空');
    const stars=group.getObjectByName('catalogue-stars');let released=0;stars.geometry.addEventListener('dispose',()=>released++);
    atmosphere.update(0,{...clear,sun:[0,-1,0]},view);assert.ok(group.visible);
    atmosphere.setQuality('low');assert.ok(stars.geometry.drawRange.count<stars.geometry.attributes.position.count);
    atmosphere.update(1,{...clear,daylight:1,sun:[0,1,0]},view);assert.equal(group.visible,false);
    atmosphere.dispose();atmosphere.dispose();assert.equal(released,1);assert.equal(scene.children.length,0);
  }finally{
    atmosphere?.dispose();globalThis.document=previous.document;globalThis.innerWidth=previous.width;globalThis.innerHeight=previous.height;
  }
});
