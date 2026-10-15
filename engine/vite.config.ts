import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import glsl from 'vite-plugin-glsl';

/** Vite's SPA fallback otherwise boots the main app on retired directory URLs.
 * Serve only the two exact legacy namespaces from their existing public stubs.
 * This dev-only adapter adds no application entry or production-server config. */
export function retiredModeRedirects(): Plugin {
  return {
    name: 'galaxy-retired-mode-redirects',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0];
        const match = /^\/(space|observer)\/?$/.exec(pathname);
        if (!match || !['GET', 'HEAD'].includes(request.method ?? 'GET')) return next();
        const file = resolve(server.config.publicDir, match[1], 'index.html');
        void readFile(file).then(data => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(request.method === 'HEAD' ? undefined : data);
        }, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [retiredModeRedirects(), glsl()],
  base: './',
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: 'src/index.html' } },
  },
});
