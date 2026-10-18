const frame = document.querySelector('#app'), status = document.querySelector('#status'), report = document.querySelector('#report');
const results = [];
const html = await (await fetch('/')).text();
const instrumented = html.replace('<head>', '<head><base href="/"><script type="module" src="/tests/performance-probe.js"><\/script>');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const app = () => frame.contentWindow;
const click = selector => app().document.querySelector(selector)?.click();
function chooseWeather(weather) {
  click('[data-weather="sunny"]');
  if(weather==='typhoon'){click('[data-weather="rain"]');click('[data-weather="rain"]');}
  else if(weather!=='sunny')click(`[data-weather="${weather}"]`);
}
function output() {
  report.textContent = JSON.stringify(results, null, 2);
  document.querySelector('#summary').replaceChildren(...results.map(result => {
    const row = document.createElement('tr');
    const rounded = value => value == null ? '—' : value.toFixed(2);
    const values = [result.phase, rounded(result.fps), rounded(result.callbackP50), rounded(result.callbackP95),
      rounded(result.heapMiB), result.geometries, result.textures, result.programs, result.longTasks,result.cloudAtlases,result.cloudForms,
      result.appRemoved == null ? '—' : `场景移除 ${result.appRemoved}，画布 ${result.canvasCount}，上下文释放 ${result.contextLost}`];
    row.replaceChildren(...values.map(value => { const cell = document.createElement('td'); cell.textContent=value ?? '—'; return cell; }));
    return row;
  }));
}
async function ready() {
  for (let i=0; i<240; i++) { if (app().performanceProbe?.snapshot().ready) return; await delay(250); }
  throw new Error('主页面未在60秒内就绪');
}
async function mount() {
  const loaded = new Promise(resolve => frame.addEventListener('load',resolve,{once:true}));
  frame.srcdoc=instrumented; await loaded; await ready();
}
async function phase(name, action) {
  status.textContent = `正在检查：${name}`;
  action(); await delay(2500); app().performanceProbe.reset(); await delay(8000);
  results.push({ phase:name, ...app().performanceProbe.snapshot() }); output();
}
document.querySelector('#run').onclick = async event => {
  event.target.disabled = true; results.length = 0; output();
  try {
    await mount();
    click('#auto-weather'); click('#auto-season'); click('#time-toggle');
    await phase('晴天·精细', () => click('[data-weather="sunny"]'));
    await phase('台风·精细', () => chooseWeather('typhoon'));
    await phase('台风后晴天·精细', () => click('[data-weather="sunny"]'));
    await phase('冬夜极光·精细', () => click('#aurora-toggle'));
    await phase('冬夜极光·均衡', () => click('#quality'));
    await phase('冬夜极光·流畅', () => click('#quality'));
    await phase('重复切换天气与关闭极光', () => {
      for(let i=0;i<8;i++)for(const weather of ['sunny','rain','storm','typhoon','snow'])chooseWeather(weather);
      click('[data-weather="sunny"]'); click('#aurora-toggle');
    });
    await phase('全部云形·少·精细',()=>{
      click('#quality');
      const range=app().document.querySelector('#time-range');
      range.value=14.5;range.dispatchEvent(new (app().Event)('input',{bubbles:true}));
      chooseWeather('cloudy');click('[data-weather="cloudy"]');
    });
    await phase('全部云形·中·精细',()=>click('[data-weather="cloudy"]'));
    await phase('全部云形·多·精细',()=>click('[data-weather="cloudy"]'));
    await phase('云图反复切换后回到默认',()=>{
      for(let i=0;i<20;i++)click('[data-weather="cloudy"]');
      click('[data-weather="cloudy"]');
    });
    status.textContent = '检查完成';
  } catch(error) { status.textContent=error.message; }
  finally { event.target.disabled=false; }
};
document.querySelector('#cleanup').onclick = () => {
  results.push({ phase:'显式退出释放', ...app().performanceProbe.cleanup() }); output(); status.textContent='已检查资源释放';
};
await mount(); status.textContent='场景已就绪，可运行检查';
