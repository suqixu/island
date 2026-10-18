import {createFilmUI} from '../src/film-ui.js';

const assert=(value,message)=>{if(!value)throw new Error(message);};
export async function runFilmUIBrowserTests(){
  const state={active:true,status:'playing',paused:false,time:0,duration:120,rate:1};
  let volume=.6,screenshots=0,paused=0,resumed=0;
  const panel=document.createElement('div');document.body.append(panel);
  const player={getState:()=>({...state}),load(){},pause(){paused++;state.status='paused';state.paused=true;ui.update(sample,state);},resume(){resumed++;state.status='playing';state.paused=false;ui.update(sample,state);},seek(time){state.time=time;ui.update(sample,state);},setRate(rate){state.rate=rate;ui.update(sample,state);},exit(){state.active=false;state.status='idle';ui.update(sample,state);}};
  const sample={fade:0,captions:[]};
  const ui=createFilmUI({player,library:{films:[],errors:[]},getVolume:()=>volume,setVolume:value=>volume=value,onScreenshot:()=>screenshots++,filmLibraryPanel:{view:panel,open(){}},closePanel(){}});
  const root=document.querySelector('.film-interface'),screen=root.querySelector('.film-screen'),controls=root.querySelector('.film-controls'),slider=root.querySelector('.film-timeline input');
  const mutations=[];const observer=new MutationObserver(records=>mutations.push(...records));observer.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});
  const take=()=>{mutations.push(...observer.takeRecords());return mutations.splice(0);};
  const frame=time=>{state.time=time;ui.update(sample,state);};
  const reveal=()=>screen.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientY:innerHeight-2}));
  try{
    frame(.1);take();for(let i=0;i<120;i++)frame(.1+i/1000);
    const hidden=take();assert(hidden.length===0,`隐藏底栏同秒重复帧应无DOM写入，实际 ${hidden.length}`);
    assert(controls.inert&&controls.getAttribute('aria-hidden')==='true','隐藏底栏应隔离焦点和可访问状态');
    frame(30);take();assert(Number(slider.value)===0,'隐藏底栏不逐帧写进度');reveal();
    assert(!controls.inert&&controls.getAttribute('aria-hidden')==='false','唤出底栏恢复可访问状态');assert(Number(slider.value)===.25,'无后续帧时，唤出也立即同步最新进度');
    take();for(let i=0;i<10;i++)frame(30.1+i/1000);
    const shown=take();const staticUpdates=shown.filter(r=>!r.target.matches('.film-timeline input'));
    assert(staticUpdates.length===0,`显示底栏同秒只更新进度，固定控件实际写入 ${staticUpdates.length}`);
    frame(31);const seconds=take().filter(r=>r.target.matches('.film-time'));assert(seconds.length===1,'跨秒时仅更新一次时间文本');
    slider.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));slider.value='.7';slider.dispatchEvent(new Event('input',{bubbles:true}));frame(85);
    assert(Number(slider.value)===.7,'拖动时渲染不覆盖手指/鼠标选择的进度');document.dispatchEvent(new PointerEvent('pointerup'));assert(paused===1&&resumed===1,'拖动期间暂停，松开后恢复播放');
    root.querySelector('.film-volume').click();const volumeSlider=root.querySelector('.film-volume-slider');volumeSlider.value='.3';volumeSlider.dispatchEvent(new Event('input',{bubbles:true}));assert(volume===.3&&root.querySelector('.film-volume-value').textContent==='30%','竖向音量操作立即同步');assert(volumeSlider.getAttribute('aria-orientation')==='vertical','保留竖向音量语义');
    screen.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientY:100}));assert(!controls.inert,'菜单展开保护底栏不被鼠标移出隐藏');
    root.querySelector('.film-rate').click();root.querySelector('[data-rate="2"]').click();assert(state.rate===2&&root.querySelector('[data-rate="2"]').getAttribute('aria-checked')==='true','倍率变更立即同步选择状态');
    root.querySelector('.film-capture').click();await Promise.resolve();await Promise.resolve();assert(screenshots===1,'截图操作仍可触发');
    sample.fade=.25;frame(85.1);assert(root.querySelector('.film-curtain').style.opacity==='0.25','遮幕保留逐帧渐变');sample.fade=.5;frame(85.2);assert(root.querySelector('.film-curtain').style.opacity==='0.5','遮幕后续渐变不被隐藏底栏阻断');
    sample.captions=[{text:'下一幕',style:'title'}];frame(85.3);assert(root.querySelector('.film-caption').textContent==='下一幕','字幕继续随镜头更新');
    screen.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientY:100}));assert(controls.inert,'移出底部可隐藏底栏');
    screen.dispatchEvent(new MouseEvent('click',{bubbles:true,clientY:innerHeight-2}));assert(!controls.inert,'触屏底部点击无需动画帧也能唤出底栏');
    state.status='preparing';ui.update(null,state);take();for(let i=0;i<20;i++)ui.update(null,state);assert(take().length===0,'准备状态重复通知也不产生DOM写入');
    assert(root.querySelector('.film-caption').textContent==='正在准备画面与声音…','准备状态仍显示提示');
    return {hiddenSameSecondMutations:hidden.length,visibleStaticMutations:staticUpdates.length,timeMutationsAtSecondBoundary:seconds.length,dragPauseResume:[paused,resumed]};
  }finally{observer.disconnect();ui.dispose();panel.remove();}
}
window.filmUIResult=runFilmUIBrowserTests().then(result=>({passed:true,result})).catch(error=>({passed:false,error:error.message,stack:error.stack}));
