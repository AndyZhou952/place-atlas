import { existsSync } from 'node:fs';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Prefer the ignored deployment config; wrangler.owner-poc.local.jsonc is the pre-0.2 name.
const configPath =
  ['wrangler.local.jsonc', 'wrangler.owner-poc.local.jsonc'].find((path) => existsSync(path)) ??
  'wrangler.jsonc';

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath,
      viteEnvironment: { name: 'server' },
      // Older local configs point at the removed Next.js entry file.
      config: (config) => {
        config.main = './src/server/worker.ts';
        config.assets = {
          ...config.assets,
          not_found_handling: 'single-page-application',
          run_worker_first: ['/api/*'],
        };
      },
    }),
  ],
});
