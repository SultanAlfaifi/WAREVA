import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = path => fileURLToPath(new URL(path, import.meta.url));

// The public site: landing page + 3D experience. Built to web/dist and published by .github/workflows/pages.yml.
export default defineConfig({
  root: 'web',
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 700, // three.js alone is ~550 kB; it is loaded only on the experience page
    rollupOptions: { input: { main: page('./web/index.html'), experience: page('./web/experience/index.html') } },
  },
  server: { port: 4173, strictPort: true },
});
