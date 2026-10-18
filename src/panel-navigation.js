/** 原设置弹窗的内容导航：一个返回入口，保留各页与滚动位置。 */
export function createPanelNavigation(header){
  const panel=header.parentElement,document=header.ownerDocument,views=new Map();
  const settings=[...panel.children].filter(element=>element!==header).map(element=>({element,hidden:element.hidden,inert:element.inert}));
  const backButton=document.createElement('button');backButton.type='button';backButton.className='panel-navigation-return';backButton.title='返回';backButton.setAttribute('aria-label','返回上一页');backButton.hidden=true;
  backButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';header.prepend(backButton);
  let current='settings',history=[],height='',settingsHeight='',settingsScroll=0,disposed=false;
  function display(id){
    if(current==='settings'&&id!=='settings'){settingsScroll=panel.scrollTop;settingsHeight=panel.style.height;height=`${panel.getBoundingClientRect().height}px`;}
    current=id;const atSettings=id==='settings';
    for(const {element,hidden,inert} of settings){element.hidden=atSettings?hidden:true;element.inert=atSettings?inert:true;}
    for(const [key,{view,button}] of views){view.hidden=key!==id;view.inert=key!==id;button?.setAttribute('aria-expanded',String(key===id));button?.classList.toggle('selected',key===id);}
    panel.classList.toggle('showing-updates',id==='updates');panel.classList.toggle('showing-films',id==='films');
    panel.style.height=atSettings?settingsHeight:height;backButton.hidden=history.length===0;
    panel.scrollTop=atSettings?settingsScroll:0;
  }
  function show(id){
    if(disposed||id===current||id!=='settings'&&!views.has(id))return;
    const previous=history.lastIndexOf(id);if(previous>=0)history=history.slice(0,previous);else history.push(current);display(id);
  }
  function back(){if(!disposed&&history.length)display(history.pop());}
  backButton.addEventListener('click',back);
  return {show,back,get current(){return current;},register(id,view,button){views.set(id,{view,button});view.hidden=id!==current;view.inert=id!==current;},leave(id){if(current===id)back();},dispose(){if(disposed)return;history=[];display('settings');disposed=true;backButton.removeEventListener('click',back);backButton.remove();views.clear();}};
}
