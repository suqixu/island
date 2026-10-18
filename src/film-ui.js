import config from './config/film.json' with {type:'json'};
import {createFilmPresentation} from './film-presentation.js';

const paths={rate:'M4 17a9 9 0 1 1 16 0M12 12l5-5M12 3v2M3 12h2m14 0h2',play:'M8 5v14l11-7z',pause:'M8 5v14M16 5v14',restart:'M4 10a8 8 0 1 1 1.8 8M4 4v6h6',exit:'M9 4H4v16h5M13 7l5 5-5 5M8 12h10',capture:'M4 6h4l2-3h4l2 3h4v14H4zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'};
Object.assign(paths,{volume:'M3 9v6h4l5 4V5L7 9zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',muted:'M3 9v6h4l5 4V5L7 9zM17 9l5 6m0-6-5 6',fullscreen:'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',exitFullscreen:'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5'});
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
function control(button,name,label){if(button.dataset.icon===name&&button.getAttribute('aria-label')===label)return;button.dataset.icon=name;button.innerHTML=icon(name);const hidden=button.ownerDocument.createElement('span');hidden.className='visually-hidden';hidden.textContent=label;button.append(hidden);button.setAttribute('aria-label',label);button.title=label;}
const format=seconds=>{const whole=Math.max(0,Math.floor(seconds+1e-6));return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;};
export function createFilmUI({player,library,onError=()=>{},onScreenshot=()=>{},getVolume=()=>config.presentation.volume,setVolume=()=>{},filmLibraryPanel,closePanel=()=>{},document=globalThis.document}) {
  const labels=config.labels,root=document.createElement('div');root.className='film-interface';
  root.innerHTML=`<section class="film-screen" aria-label="宣传片播放器" hidden>
    <div class="film-curtain"></div><div class="film-controls-shade"></div><div class="film-caption" aria-live="off"></div>
    <button class="film-gesture-toggle" type="button"></button>
    <div class="film-controls">
      <div class="film-timeline"><input type="range" min="0" max="1" step="0.0001" value="0" aria-label="播放进度"/></div>
      <div class="film-controls-row">
        <div class="film-controls-left"><button class="film-pause" type="button"></button><span class="film-time"></span></div>
        <div class="film-controls-right">
          <div class="film-rate-control"><button class="film-rate" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="film-rate-options"></button><div class="film-rate-menu" id="film-rate-options" role="menu" hidden></div></div>
          <div class="film-volume-control"><button class="film-volume" type="button" aria-expanded="false" aria-controls="film-volume-panel"></button><div class="film-volume-panel" id="film-volume-panel" hidden><div class="film-volume-heading"><button class="film-mute" type="button"></button><span class="film-volume-value"></span></div><input class="film-volume-slider" type="range" min="0" max="1"/></div></div>
          <button class="film-capture" type="button"></button><button class="film-fullscreen" type="button"></button><button class="film-exit" type="button"></button>
        </div>
      </div>
    </div>
  </section>`;
  const menu=filmLibraryPanel.view;
  menu.innerHTML='<div class="film-list" role="list" aria-label="宣传片"></div><p class="film-message" role="status"></p>';
  document.body.append(root);const $=selector=>root.querySelector(selector)??menu.querySelector(selector),screen=$('.film-screen'),message=$('.film-message'),pause=$('.film-pause');
  control($('.film-exit'),'exit',labels.exit);
  control($('.film-capture'),'capture',labels.capture);
  const listeners=[];let disposed=false,lastCaption='',presentation,menuDismissed=false;
  let lastStatus,lastActive,lastRate,lastVolume,lastFullscreen,lastTime,lastFade,lastCaptionStyle,latestState,controlsVisible=false;
  const listen=(object,name,handler,options)=>{object.addEventListener(name,handler,options);listeners.push(()=>object.removeEventListener(name,handler,options));};
  const run=action=>Promise.resolve().then(action).catch(error=>{message.textContent=error.message;onError(error);});
  const buttons=[];
  for(const film of library.films){const button=document.createElement('button');button.className='film-selection';button.type='button';const name=document.createElement('span'),duration=document.createElement('small');name.textContent=film.script.title;duration.textContent=format(film.script.duration);button.innerHTML=icon('play');button.append(name,duration);button.setAttribute('aria-label',`${labels.play} ${film.script.title}`);button.title=`${labels.play} · ${film.script.title}`;const item=document.createElement('div');item.setAttribute('role','listitem');item.append(button);$('.film-list').append(item);buttons.push({button,film});listen(button,'click',()=>run(()=>{player.load(film.script);select(film);const playing=player.play();presentation.enterFullscreen();return playing;}));}
  function select(film){for(const item of buttons){const selected=item.film.id===film.id;item.button.classList.toggle('selected',selected);item.button.setAttribute('aria-pressed',String(selected));}message.textContent='';}
  if(library.films.length){player.load(library.films[0].script);select(library.films[0]);}else{message.textContent=library.errors[0]?.message??'暂时没有可播放的宣传片';}
  const slider=$('.film-timeline input'),rateButton=$('.film-rate'),rateMenu=$('.film-rate-menu'),rateControl=$('.film-rate-control'),rateOptions=[];
  const volumeButton=$('.film-volume'),volumePanel=$('.film-volume-panel'),volumeControl=$('.film-volume-control'),volumeSlider=$('.film-volume-slider');
  let lastAudibleVolume=getVolume()||config.presentation.volume;
  volumePanel.setAttribute('role','group');volumePanel.setAttribute('aria-label',labels.volume);volumeSlider.setAttribute('aria-label',labels.volume);volumeSlider.setAttribute('aria-orientation','vertical');volumeSlider.setAttribute('orient','vertical');volumeSlider.step=String(config.presentation.volumeStep);
  let seeking=false,resumeAfterSeek=false;
  const rateLabel=rate=>`${rate===1?'1.0':rate}×`;
  rateMenu.setAttribute('aria-label',labels.speed);
  function showRateMenu(open,{focus=false}={}){
    if(open)showVolume(false);
    if(rateMenu.hidden===open){rateMenu.hidden=!open;rateButton.setAttribute('aria-expanded',String(open));
      if(open)presentation?.showControls({timed:false});else presentation?.scheduleHide();}
    if(focus){if(open)(rateOptions.find(button=>Number(button.dataset.rate)===player.getState().rate)??rateOptions[0])?.focus();else rateButton.focus();}
  }
  function showVolume(open){
    if(open)showRateMenu(false);
    if(volumePanel.hidden===open){volumePanel.hidden=!open;volumeButton.setAttribute('aria-expanded',String(open));
      if(open){presentation?.showControls({timed:false});volumeSlider.focus();}else presentation?.scheduleHide();}
  }
  function renderVolume(){
    const value=getVolume();if(value===lastVolume)return;lastVolume=value;
    const percent=Math.round(value*100);volumeSlider.value=String(value);volumeSlider.style.setProperty('--film-volume',`${percent}%`);volumeSlider.setAttribute('aria-valuetext',`${percent}%`);$('.film-volume-value').textContent=`${percent}%`;
    control(volumeButton,value>0?'volume':'muted',`${labels.volume}：${percent}%`);control($('.film-mute'),value>0?'volume':'muted',value>0?labels.mute:labels.unmute);
  }
  function changeVolume(value){if(value>0)lastAudibleVolume=value;setVolume(value);renderVolume();}
  function renderFullscreen(){const full=Boolean(document.fullscreenElement);if(full===lastFullscreen)return;lastFullscreen=full;control($('.film-fullscreen'),full?'exitFullscreen':'fullscreen',full?labels.exitFullscreen:labels.fullscreen);$('.film-fullscreen').setAttribute('aria-pressed',String(full));}
  listen(volumeButton,'click',()=>showVolume(volumePanel.hidden));listen(volumeSlider,'input',()=>changeVolume(Number(volumeSlider.value)));
  listen($('.film-mute'),'click',()=>changeVolume(getVolume()>0?0:lastAudibleVolume));
  listen(volumeControl,'focusout',event=>{if(!volumeControl.contains(event.relatedTarget))showVolume(false);});
  for(const rate of [...config.playbackRates].sort((a,b)=>a-b)){
    const button=document.createElement('button');button.className='film-rate-option';button.type='button';button.dataset.rate=String(rate);button.textContent=rateLabel(rate);button.setAttribute('role','menuitemradio');rateMenu.append(button);rateOptions.push(button);
    listen(button,'click',()=>{player.setRate(rate);showRateMenu(false,{focus:true});});
  }
  listen(rateButton,'click',()=>showRateMenu(rateMenu.hidden,{focus:true}));
  listen(document,'pointerdown',event=>{const rateOutside=!rateMenu.hidden&&!rateControl.contains(event.target),volumeOutside=!volumePanel.hidden&&!volumeControl.contains(event.target);menuDismissed=rateOutside||volumeOutside;if(rateOutside)showRateMenu(false);if(volumeOutside)showVolume(false);},true);
  listen(rateMenu,'keydown',event=>{
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();
    const index=rateOptions.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?rateOptions.length-1:(index+(event.key==='ArrowDown'?1:-1)+rateOptions.length)%rateOptions.length;
    rateOptions[next].focus();
  });
  listen(rateControl,'focusout',event=>{if(!rateControl.contains(event.relatedTarget))showRateMenu(false);});
  listen(slider,'pointerdown',()=>{seeking=true;resumeAfterSeek=player.getState().status==='playing';if(resumeAfterSeek)player.pause();});
  listen(slider,'input',()=>{try{player.seek(Number(slider.value)*player.getState().duration);}catch(error){onError(error);}});
  const finishSeek=()=>{if(!seeking)return;seeking=false;if(resumeAfterSeek)player.resume();renderProgress();};
  listen(slider,'pointerup',finishSeek);listen(slider,'pointercancel',finishSeek);listen(document,'pointerup',finishSeek);listen(document,'pointercancel',finishSeek);
  const showMenu=open=>open?filmLibraryPanel.open():closePanel();
  const togglePlayback=()=>{const state=player.getState();if(state.status==='playing')player.pause();else if(state.status==='ended')run(()=>player.restart());else player.resume();};
  listen(pause,'click',togglePlayback);
  listen($('.film-capture'),'click',()=>run(onScreenshot));
  listen($('.film-fullscreen'),'click',()=>presentation.toggleFullscreen());listen(document,'fullscreenchange',renderFullscreen);
  listen($('.film-exit'),'click',()=>player.exit());
  listen(document,'keydown',event=>{if(event.key==='Escape'){if(!rateMenu.hidden){event.preventDefault();showRateMenu(false,{focus:true});}else if(!volumePanel.hidden){event.preventDefault();showVolume(false);volumeButton.focus();}else if(player.getState().active){if(!document.fullscreenElement)player.exit();}else showMenu(false);}});
  for(const type of ['pointerdown','pointerup','dblclick','wheel'])listen(root,type,event=>event.stopPropagation());
  function renderProgress(){
    if(!controlsVisible||seeking||!latestState)return;
    const {time,duration}=latestState,progress=duration?Math.max(0,Math.min(1,time/duration)):0,value=String(progress),fill=`${Math.round(progress*10000)/100}%`;
    if(slider.value!==value)slider.value=value;
    if(slider.style.getPropertyValue('--film-progress')!==fill)slider.style.setProperty('--film-progress',fill);
  }
  presentation=createFilmPresentation({screen,controls:$('.film-controls'),player,togglePlayback,isBusy:()=>seeking||!rateMenu.hidden||!volumePanel.hidden,ignoreScreenClick:()=>{const ignored=menuDismissed;menuDismissed=false;return ignored;},onControlsVisibilityChange:visible=>{controlsVisible=visible;if(visible)renderProgress();},settings:config.presentation,document});
  function update(sample,state=player.getState()){
    if(disposed)return;
    latestState=state;
    if(lastActive!==state.active){document.body.classList.toggle('film-active',state.active);screen.hidden=!state.active;lastActive=state.active;}
    presentation.update(state);
    if(state.active)showMenu(false);
    const statusChanged=lastStatus!==state.status;
    if(statusChanged){
      root.classList.toggle('film-paused',state.status!=='playing');
      control(pause,state.status==='playing'?'pause':'play',state.status==='playing'?labels.pause:state.status==='ended'?labels.restart:labels.resume);
      control($('.film-gesture-toggle'),state.status==='playing'?'pause':'play',state.status==='playing'?labels.pause:state.status==='ended'?labels.restart:labels.resume);
      $('.film-gesture-toggle').disabled=state.status==='preparing';$('.film-gesture-toggle').tabIndex=state.paused?0:-1;
      $('.film-capture').disabled=state.status==='preparing';
      volumeButton.disabled=volumeSlider.disabled=state.status==='preparing';$('.film-fullscreen').disabled=!document.documentElement.requestFullscreen;
      pause.disabled=state.status==='preparing';
      slider.disabled=state.status==='preparing';rateButton.disabled=state.status==='preparing';
      lastStatus=state.status;
    }
    renderVolume();renderFullscreen();
    if(!state.active||state.status==='preparing'){showRateMenu(false);showVolume(false);}
    if(rateButton.dataset.value!==String(state.rate)){const label=rateLabel(state.rate);control(rateButton,'rate',`${labels.speed}：${label}`);const value=document.createElement('span');value.className='film-rate-value';value.setAttribute('aria-hidden','true');value.textContent=label;rateButton.append(value);rateButton.dataset.value=String(state.rate);}
    if(lastRate!==state.rate||statusChanged){for(const button of rateOptions){const selected=Number(button.dataset.rate)===state.rate;button.setAttribute('aria-checked',String(selected));button.classList.toggle('selected',selected);button.disabled=state.status==='preparing';}lastRate=state.rate;}
    renderProgress();
    const time=`${format(state.time).padStart(5,'0')} / ${format(state.duration).padStart(5,'0')}`;
    if(time!==lastTime){$('.film-time').textContent=time;lastTime=time;}
    if(state.status==='preparing'){renderCaption(labels.preparing,'body');renderFade(1);return;}
    if(!sample||!state.active)return;
    renderFade(sample.fade);
    renderCaption(sample.captions.map(c=>c.text).join('\n'),sample.captions[0]?.style??'body');
  }
  function renderFade(fade){if(fade===lastFade)return;$('.film-curtain').style.opacity=String(fade);lastFade=fade;}
  function renderCaption(text,style){if(text!==lastCaption){$('.film-caption').textContent=text;lastCaption=text;}if(style!==lastCaptionStyle){$('.film-caption').dataset.style=style;lastCaptionStyle=style;}}
  update(null);
  return {update,open(){showMenu(true);},dispose(){if(disposed)return;disposed=true;presentation.dispose();menu.replaceChildren();for(const remove of listeners)remove();root.remove();document.body.classList.remove('film-active');}};
}
