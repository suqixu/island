import loadingConfig from './config/loading.json' with {type:'json'};
import './style.css';
import { createLoadingScreen } from './loading-screen.js';

export const loadingScreen = createLoadingScreen({
  root: document.getElementById('loading'),
  message: document.getElementById('loading-message'),
  phase: document.getElementById('loading-phase'),
  retryButton: document.getElementById('loading-retry'),
  onRetry: () => window.location.reload(),
});

loadingScreen.start();

window.addEventListener('pagehide', event => {
  if (!event.persisted) loadingScreen.dispose();
});

if (import.meta.hot) import.meta.hot.dispose(() => loadingScreen.dispose());

import('./main.js').catch(error => {
  console.error(error);
  loadingScreen.fail(loadingConfig.errors.module);
});
