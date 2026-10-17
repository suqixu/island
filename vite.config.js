import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], 'night-sky': ['./src/night-sky.js'] },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
