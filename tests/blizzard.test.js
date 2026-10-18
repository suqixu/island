import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation, advanceSimulation, getEnvironment} from '../src/simulation.js';
import {selectWeather, getWeatherButtonState} from '../src/weather-controls.js';

const simulation = overrides => createSimulation({autoWeather:false, autoSeason:false, autoMoon:false,
  holdSunClock:true, speed:1, seasonIndex:3, ...overrides});
const tick = (state, seconds) => { for(let i=0;i<seconds;i++) advanceSimulation(state,1); };

test('雪按钮循环飘雪、暴风雪、关闭，并提供相应图标和下一步说明', () => {
  const state=simulation({weather:'sunny'});
  for(const [weather,icon,next] of [['snow','snow','暴风雪'],['blizzard','blizzard','关闭'],['sunny','snow','飘雪']]) {
    selectWeather(state,'snow');
    assert.equal(state.weather,weather);
    const button=getWeatherButtonState(state,'snow');
    assert.equal(button.icon,icon); assert.equal(button.selected,weather!=='sunny');
    assert.ok(button.label.includes(next)); assert.equal(state.autoWeather,false);
  }
});

test('暴风雪拥有强风和台风级海浪驱动力，但不产生雨和雷电', () => {
  const snow=getEnvironment(simulation({weather:'snow',windSeed:42}));
  const blizzard=getEnvironment(simulation({weather:'blizzard',windSeed:42}));
  assert.equal(blizzard.snow,1); assert.equal(blizzard.rain,0); assert.equal(blizzard.storm,0);
  assert.equal(blizzard.blizzard,1); assert.equal(blizzard.typhoon,0);
  assert.ok(blizzard.windSpeed>snow.windSpeed*2); assert.ok(blizzard.roughSea>.5);
  assert.equal(snow.roughSea,0);
});

test('积雪逐渐累积，暴风雪比普通飘雪更快，场景之间互相独立', () => {
  const snow=simulation({weather:'snow'}),blizzard=simulation({weather:'blizzard'}),other=simulation({weather:'sunny'});
  assert.equal(getEnvironment(snow).snowCover,0);
  tick(snow,25); tick(blizzard,25);
  assert.ok(snow.snowCover>.1&&snow.snowCover<.8);
  assert.ok(blizzard.snowCover>snow.snowCover);
  assert.equal(getEnvironment(other).snowCover,0);
});

test('持续降雪达到上限后保持稳定，各场景的覆盖节奏有差异且停雪后逐渐减少', () => {
  const a=simulation({weather:'snow',windSeed:1}),b=simulation({weather:'snow',windSeed:532});
  tick(a,25);tick(b,25);assert.notEqual(a.snowCover,b.snowCover);
  tick(a,150);assert.equal(a.snowCover,1);tick(a,150);assert.equal(a.snowCover,1);
  selectWeather(a,'sunny');tick(a,26);const cover=a.snowCover;
  assert.ok(cover<1&&cover>.98);tick(a,10);assert.ok(a.snowCover<cover&&a.snowCover>.95);
});

test('停雪后先保留，再按温度融化，再次下雪从剩余量继续累积', () => {
  const cold=simulation({weather:'snow'}); tick(cold,45);
  const cover=cold.snowCover; selectWeather(cold,'sunny'); tick(cold,10);
  assert.equal(cold.snowCover,cover);
  const warm=simulation({...cold,seasonIndex:1});
  tick(cold,100);tick(warm,100);
  assert.ok(cold.snowCover<cover&&cold.snowCover>0);
  assert.ok(warm.snowCover<cold.snowCover);
  const remaining=cold.snowCover; selectWeather(cold,'snow'); tick(cold,5);
  assert.ok(cold.snowCover>remaining);
  cold.running=false; const paused=cold.snowCover; tick(cold,20);assert.equal(cold.snowCover,paused);
});

test('自动暴风雪仅在冬季低概率出现，且不连续重复', () => {
  for(const seasonIndex of [0,1,2,3]) {
    const state=simulation({autoWeather:true,seasonIndex,weather:'sunny',weatherDuration:1});
    advanceSimulation(state,1,()=>.99);
    assert.equal(state.weather==='blizzard',seasonIndex===3);
    if(seasonIndex===3) {
      state.weatherDuration=1; advanceSimulation(state,1,()=>.99);
      assert.notEqual(state.weather,'blizzard');
    }
  }
});

test('进入冬季不会凭空积雪，明确的雪面量优先于正在下雪的强度', async () => {
  const {getSnowCover}=await import('../src/snow-surface.js');
  assert.equal(getSnowCover({snowCover:0,snow:1,season:'winter'}),0);
  assert.equal(getSnowCover({snowCover:.4,snow:0}),.4);
  const state=simulation({weather:'sunny'});tick(state,120);
  assert.equal(state.snowCover,0);
});

test('山体、散石、树木与码头共用积雪状态，停雪后仍读取残余雪量', async () => {
  const THREE=await import('three');
  const {createIsland}=await import('../src/models/island.js');
  const island=createIsland(new THREE.Scene());
  try {
    const names=['连续海床与火山岛','海岸玄武岩-1','森林树干与分叉','森林细枝-1','独立木铺板'];
    const shaders=names.map(name=>{
      const mesh=island.group.getObjectByName(name);assert.ok(mesh, name);
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
      mesh.material.onBeforeCompile(shader);assert.ok(shader.uniforms.uSurfaceSnow,name);
      return shader;
    });
    for(let time=.1;time<=3;time+=.1)island.update(time,{snow:0,snowCover:.6});
    for(const shader of shaders)assert.ok(shader.uniforms.uSurfaceSnow.value>.5);
    assert.ok(shaders.every(shader=>shader.uniforms.uSurfaceSnow===shaders[0].uniforms.uSurfaceSnow));
  } finally {island.dispose();}
});

test('洞口藤蔓和蕨叶在雪天褪绿，停雪后仍遵循残余积雪量', async () => {
  const THREE=await import('three');const {createIsland}=await import('../src/models/island.js');
  const island=createIsland(new THREE.Scene());
  try {
    const mesh=island.group.getObjectByName('洞口贴岩苔草与小蕨');
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    mesh.material.onBeforeCompile(shader);
    for(let t=.1;t<3;t+=.1)island.update(t,{seasonIndex:1,snow:1,snowCover:.8});
    assert.ok(shader.uniforms.uFoliageWinter?.value>.9);
    assert.ok(shader.uniforms.uSurfaceSnow?.value>.7);
    for(let t=3;t<6;t+=.1)island.update(t,{seasonIndex:1,snow:0,snowCover:.7});
    assert.ok(shader.uniforms.uFoliageWinter.value>.9);
  } finally {island.dispose();}
});

test('码头有独立厚雪层，堆积与消退复用几何且零雪量时隐藏', async () => {
  const THREE=await import('three');const {createIsland}=await import('../src/models/island.js');
  const island=createIsland(new THREE.Scene());
  try {
    const cap=island.group.getObjectByName('码头铺板积雪');assert.ok(cap?.isInstancedMesh);
    assert.equal(cap.count,47);assert.ok(cap.geometry.attributes.aSnowBase);assert.equal(cap.visible,false);
    const geometry=cap.geometry;
    for(let t=.1;t<3;t+=.1)island.update(t,{snow:1,snowCover:1});assert.equal(cap.visible,true);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    cap.material.onBeforeCompile(shader);assert.ok(shader.uniforms.uSurfaceSnow.value>.95);
    for(let t=3;t<6;t+=.1)island.update(t,{snow:0,snowCover:.4});assert.ok(shader.uniforms.uSurfaceSnow.value<.5);
    assert.equal(cap.geometry,geometry);
  } finally {island.dispose();}
});

test('跨季节手动下雪也让树冠进入冬态，积雪未融时全岛野花保持隐藏', async () => {
  const THREE=await import('three');const {createIsland}=await import('../src/models/island.js');
  const island=createIsland(new THREE.Scene());
  try {
    const flowers=[];island.group.traverse(mesh=>{if(/野花|花朵|花簇/.test(mesh.name))flowers.push(mesh);});
    assert.ok(flowers.length>=2);
    for(let t=.1;t<3;t+=.1)island.update(t,{seasonIndex:0,snow:1,snowCover:.7});
    assert.ok(flowers.every(mesh=>!mesh.visible),'正在大雪时鲜花全部隐藏');
    const canopy=island.group.getObjectByName('阔叶冠层-1');
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    canopy.material.onBeforeCompile(shader);
    assert.ok(shader.uniforms.uFoliageWinter?.value>.9,'即使春季手动下雪也不能保留绿树');
    for(let t=3;t<6;t+=.1)island.update(t,{seasonIndex:0,snow:0,snowCover:.6});
    assert.ok(flowers.every(mesh=>!mesh.visible),'雪停后残余积雪继续抑制鲜花');
    assert.ok(shader.uniforms.uFoliageWinter.value>.75);
  } finally {island.dispose();}
});

test('雪后转雨会立即温和融雪，无雨时仍保留停雪等待期', () => {
  const snow=simulation({weather:'snow',windSeed:42});tick(snow,45);
  const dry=simulation({...snow}),rain=simulation({...snow});
  selectWeather(dry,'sunny');selectWeather(rain,'rain');
  const cover=snow.snowCover;
  advanceSimulation(dry,.1);advanceSimulation(rain,.1);
  assert.equal(dry.snowCover,cover);
  assert.ok(rain.snowCover<cover,'下雨应开始融化残雪');
  assert.ok(rain.snowCover>cover-.001,'切换下雨不能让积雪突然消失');
});

test('保留相同积雪、种子和时刻时，雨越大融雪越快，低温仍然较慢', () => {
  const base={snowCover:.8,snowMeltDelay:0,windSeed:42,hour:14};
  const dry=simulation({...base,weather:'sunny'}),rain=simulation({...base,weather:'rain'}),storm=simulation({...base,weather:'storm'});
  const warmRain=simulation({...base,weather:'rain',seasonIndex:1});
  for(const state of [dry,rain,storm,warmRain])tick(state,20);
  assert.ok(rain.snowCover<dry.snowCover,'雨水应抵消降雨降温影响并加速融雪');
  assert.ok(storm.snowCover<rain.snowCover,'更大雨量应进一步加速');
  assert.ok(warmRain.snowCover<rain.snowCover,'相同雨量下低温融化较慢');
  const stopped=simulation({...base,weather:'rain',running:false});tick(stopped,30);assert.equal(stopped.snowCover,.8);
  advanceSimulation(warmRain,10000);assert.equal(warmRain.snowCover,0,'长时间大雨融尽后仍须限制下界');
});
