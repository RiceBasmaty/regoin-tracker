// Vite builds app/ into dist/app/. In dev and preview, /data/* is served from the
// pipeline output (dist/data) with HTTP Range support, which PMTiles needs.
import { defineConfig } from 'vite';
import sirv from 'sirv';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import versions from './data/data-version.json' with { type: 'json' };

const dataDir = fileURLToPath(new URL('./dist/data', import.meta.url));
const serveData = () => {
  const handler = sirv(dataDir, { dev: true, etag: true });
  // A missing file must be a real 404; otherwise Vite would answer with index.html and
  // the map would fail with a confusing error.
  const notFound = (_req, res) => { res.statusCode = 404; res.end('Not found'); };
  const mount = (server) => {
    server.middlewares.use('/data', (req, res) => handler(req, res, () => notFound(req, res)));
    // Say clearly, in the terminal, which folder the app reads its map data from.
    const manifest = resolve(dataDir, `v${versions.dataVersion}`, 'manifest.json');
    const projectDir = resolve(dataDir, '..', '..');
    if (existsSync(manifest)) console.log(`\n  Map data: found in ${resolve(dataDir)}\n`);
    else console.warn(`\n  ⚠ Map data NOT found in ${resolve(dataDir)}\n    Run this in ${projectDir}:  pipeline/run_all.sh   (about 20 minutes, once)\n`);
  };
  return { name: 'serve-pipeline-data', configureServer: mount, configurePreviewServer: mount };
};

// MapLibre's worker (~145 KB) is otherwise only requested after the main script has run.
// A preload hint lets the browser fetch both at the same time.
const preloadMapWorker = () => ({
  name: 'preload-map-worker',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const worker = Object.keys(ctx.bundle ?? {}).find((f) => f.includes('maplibre-gl-worker') && f.endsWith('.mjs'));
      if (!worker) return html;
      return html.replace('</head>', `  <link rel="modulepreload" href="./${worker}" />\n  </head>`);
    },
  },
});

export default defineConfig({
  root: 'app',
  base: './',
  plugins: [serveData(), preloadMapWorker()],
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
