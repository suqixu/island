import { currentVersion, releaseNotes } from './release-notes.js';

let nextHistoryId = 0;

/** Switches settings and release notes within the existing draggable panel. */
export function createUpdateHistory(panelHeader,{navigation}={}) {
  const panel = panelHeader.parentElement;
  const document = panelHeader.ownerDocument;
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const button = create('button', 'panel-version', `v${currentVersion}`);
  button.type = 'button';
  button.title = '查看版本更新记录';
  button.setAttribute('aria-label', `版本 ${currentVersion}，查看更新记录`);
  button.setAttribute('aria-expanded', 'false');

  const view = create('section', 'panel-update-history');
  view.id = `panel-update-history-${++nextHistoryId}`;
  view.hidden = true;
  view.setAttribute('aria-label', '版本更新记录');
  button.setAttribute('aria-controls', view.id);
  const returnButton = create('button', 'panel-update-return');
  returnButton.type = 'button';
  returnButton.title = '返回设置';
  returnButton.setAttribute('aria-label', '返回设置');
  returnButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';
  returnButton.hidden = true;
  for (const release of releaseNotes) {
    const section = create('section', 'panel-update-release');
    section.append(create('h3', '', `v${release.version}`));
    const list = create('ul');
    for (const item of release.items) list.append(create('li', '', item));
    section.append(list);
    view.append(section);
  }
  panelHeader.prepend(button);
  if(navigation){
    panel.append(view);navigation.register('updates',view,button);
    const open=()=>navigation.show('updates');button.addEventListener('click',open);
    return {close:()=>navigation.leave('updates'),dispose(){navigation.leave('updates');button.removeEventListener('click',open);view.remove();button.remove();}};
  }
  panelHeader.prepend(returnButton);
  panel.append(view);
  let settings = null;
  let settingsScrollTop = 0;
  let settingsHeight = '';
  let disposed = false;

  function open() {
    if (disposed || settings) return;
    settingsScrollTop = panel.scrollTop;
    settingsHeight = panel.style.height;
    const height = panel.getBoundingClientRect().height;
    panel.style.height = `${height}px`;
    panel.classList.add('showing-updates');
    settings = [...panel.children]
      .filter(element => element !== panelHeader && element !== view)
      .map(element => ({ element, hidden: element.hidden, inert: element.inert }));
    for (const { element } of settings) {
      element.hidden = true;
      element.inert = true;
    }
    panel.setAttribute('data-update-history-open', '');
    view.hidden = false;
    returnButton.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    panel.scrollTop = 0;
    returnButton.focus();
  }
  function close() {
    if (!settings) return;
    for (const { element, hidden, inert } of settings) {
      element.hidden = hidden;
      element.inert = inert;
    }
    settings = null;
    view.hidden = true;
    returnButton.hidden = true;
    panel.removeAttribute('data-update-history-open');
    panel.classList.remove('showing-updates');
    panel.style.height = settingsHeight;
    button.setAttribute('aria-expanded', 'false');
    if (!disposed) button.focus({ preventScroll: true });
    panel.scrollTop = settingsScrollTop;
  }
  button.addEventListener('click', open);
  returnButton.addEventListener('click', close);

  return {
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      button.removeEventListener('click', open);
      returnButton.removeEventListener('click', close);
      view.remove();
      returnButton.remove();
      button.remove();
    },
  };
}
