/** 全屏归属、底部唤出和画面手势只作用于观影期间。 */
export function createFilmPresentation({screen,controls,player,togglePlayback,isBusy=()=>false,ignoreScreenClick=()=>false,onControlsVisibilityChange=()=>{},settings,document=screen.ownerDocument}){
  const root=screen.parentElement,listeners=[];
  let active=false,visible,pressed=false,mouseAtBottom=false,keyboardMode=false;
  let hideTimer,feedbackTimer,fullscreenRevision=0,ownsFullscreen=false,disposed=false;
  const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options));};
  function show(yes){if(visible===yes)return;visible=yes;root.classList.toggle('film-controls-visible',yes);controls.inert=!yes;controls.setAttribute('aria-hidden',String(!yes));onControlsVisibilityChange(yes);}
  function hideControls(){if(pressed||isBusy()||(keyboardMode&&controls.contains(document.activeElement)))return;show(false);}
  function scheduleHide(){clearTimeout(hideTimer);if(!active)return;hideTimer=setTimeout(()=>{if(!mouseAtBottom)hideControls();},settings.controlsHideMs);}
  function showControls({timed=true}={}){if(!active)return;show(true);clearTimeout(hideTimer);if(timed)scheduleHide();}
  function feedback(){clearTimeout(feedbackTimer);root.classList.add('film-feedback-visible');feedbackTimer=setTimeout(()=>root.classList.remove('film-feedback-visible'),settings.feedbackMs);}
  function toggle(){if(!active||player.getState().status==='preparing')return;togglePlayback();feedback();}
  function releaseFullscreen(){
    fullscreenRevision++;const release=ownsFullscreen&&document.fullscreenElement===document.documentElement;ownsFullscreen=false;
    if(release)Promise.resolve(document.exitFullscreen?.()).catch(()=>{});
  }
  function enterFullscreen({automatic=true}={}){
    if(!active||(automatic&&!settings.defaultFullscreen)||document.fullscreenElement||!document.documentElement.requestFullscreen)return;
    const revision=++fullscreenRevision;
    try{Promise.resolve(document.documentElement.requestFullscreen()).then(()=>{
      if(disposed||revision!==fullscreenRevision||!active){if(document.fullscreenElement===document.documentElement)Promise.resolve(document.exitFullscreen?.()).catch(()=>{});return;}
      ownsFullscreen=true;
    }).catch(()=>{});}catch{/* 不支持原生全屏时继续使用占满网页的观影画面。 */}
  }
  function toggleFullscreen(){
    if(!active)return;
    if(document.fullscreenElement){fullscreenRevision++;ownsFullscreen=false;try{Promise.resolve(document.exitFullscreen?.()).catch(()=>{});}catch{} }
    else enterFullscreen({automatic:false});
  }
  listen(document,'fullscreenchange',()=>{if(!document.fullscreenElement)ownsFullscreen=false;});
  listen(screen,'pointermove',event=>{
    if(!active||event.pointerType==='touch')return;
    mouseAtBottom=event.clientY>=screen.getBoundingClientRect().bottom-settings.bottomRevealHeight;
    if(mouseAtBottom||controls.contains(event.target))showControls({timed:false});else hideControls();
  });
  listen(screen,'pointerleave',()=>{mouseAtBottom=false;scheduleHide();});
  listen(screen,'pointerdown',event=>{
    keyboardMode=false;if(event.pointerType==='touch')mouseAtBottom=false;
    if(controls.contains(event.target)){pressed=true;showControls({timed:false});}
  });
  const releasePointer=()=>{if(!pressed)return;pressed=false;scheduleHide();};
  listen(document,'pointerup',releasePointer,true);listen(document,'pointercancel',releasePointer,true);
  listen(screen,'click',event=>{
    const ignored=ignoreScreenClick();if(controls.contains(event.target))return;
    if(event.target.closest('.film-gesture-toggle')){toggle();return;}
    if(event.clientY>=screen.getBoundingClientRect().bottom-settings.bottomRevealHeight){showControls();return;}
    if(!ignored){hideControls();toggle();}
  });
  listen(document,'keydown',event=>{if(active&&event.key==='Tab'){keyboardMode=true;showControls({timed:false});}});
  listen(controls,'focusout',event=>{if(!controls.contains(event.relatedTarget)){keyboardMode=false;scheduleHide();}});
  show(false);
  return {enterFullscreen,toggleFullscreen,showControls,scheduleHide,
    update(state){
      const next=Boolean(state.active);if(next===active)return;active=next;
      clearTimeout(hideTimer);clearTimeout(feedbackTimer);root.classList.remove('film-feedback-visible');show(false);pressed=mouseAtBottom=keyboardMode=false;
      if(!active)releaseFullscreen();
    },
    dispose(){if(disposed)return;disposed=true;active=false;clearTimeout(hideTimer);clearTimeout(feedbackTimer);releaseFullscreen();for(const remove of listeners)remove();root.classList.remove('film-controls-visible','film-feedback-visible');},
  };
}
