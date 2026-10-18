/** 影片与环境设置共用原来的可拖动弹窗，片单只滚动内容区。 */
export function createFilmLibraryPanel(header,{navigation,showPanel=()=>{}}={}) {
  const panel=header.parentElement,document=header.ownerDocument;
  const button=document.createElement('button');button.type='button';button.id='film-toggle';button.className='panel-film-toggle';button.title='影片列表';button.setAttribute('aria-label','影片列表');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','panel-films');
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4M10 9l5 3-5 3z"/></svg>';
  const view=document.createElement('section');view.id='panel-films';view.className='panel-film-library';view.setAttribute('aria-label','影片列表');view.hidden=true;panel.append(view);
  header.insertBefore(button,header.querySelector('.panel-version'));
  header.insertBefore(header.querySelector('.panel-navigation-return'),button);
  navigation.register('films',view,button);
  const open=()=>{navigation.show('films');showPanel(true);};button.addEventListener('click',open);
  return {view,open,close:()=>navigation.leave('films'),get active(){return navigation.current==='films';},dispose(){navigation.leave('films');button.removeEventListener('click',open);button.remove();view.remove();}};
}
