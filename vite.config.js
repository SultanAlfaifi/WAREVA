import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const page = path => fileURLToPath(new URL(path, import.meta.url));
const BRAND = page('./brand/');
const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css', '.json': 'application/json' };

// The pages link ../brand/... like the built site does; in development serve that folder at /brand.
const brandInDev = {
  name: 'wareva-brand-dev',
  configureServer(server) {
    server.middlewares.use('/brand', async (req, res, next) => {
      const file = normalize(BRAND + decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(normalize(BRAND))) return next();
      try {
        const body = await readFile(file);
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(body);
      } catch { next(); }
    });
  },
};

// The public site: landing page + 3D control room. Built to web/dist and published by .github/workflows/pages.yml.
export default defineConfig({
  root: 'web',
  base: './',
  publicDir: false,
  plugins: [brandInDev],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1100, // three.js, postprocessing and camera-controls: about 290 kB gzipped
    rollupOptions: { input: { main: page('./web/index.html'), experience: page('./web/experience/index.html') } },
  },
  server: { port: 4173, strictPort: true },
});
