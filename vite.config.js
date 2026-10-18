import { defineConfig } from 'vite';
import loadingConfig from './src/config/loading.json' with {type:'json'};

const textHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

export default defineConfig({
  base: './',
  plugins: [{
    name: 'isola-loading-copy',
    transformIndexHtml(html) {
      return html.replace('<!-- isola:loading-message -->',textHtml(loadingConfig.messages[0]+loadingConfig.suffix));
    },
  }],
  build: {
    outDir: 'tmp/build',
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], 'night-sky': ['./src/night-sky.js'] },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
