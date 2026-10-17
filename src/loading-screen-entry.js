import './style.css';
import { createLoadingScreen } from './loading-screen.js';

export const loadingScreen = createLoadingScreen({
  root: document.getElementById('loading'),
  message: document.getElementById('loading-message'),
});

loadingScreen.start();

window.addEventListener('pagehide', event => {
  if (!event.persisted) loadingScreen.dispose();
});

if (import.meta.hot) import.meta.hot.dispose(() => loadingScreen.dispose());

import('./main.js').catch(error => {
  console.error(error);
  loadingScreen.fail('海岛资源未能加载，请检查网络后刷新页面重试。');
});
