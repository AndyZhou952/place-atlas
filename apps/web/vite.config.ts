import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption, type UserConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

interface CloudflarePluginOptions {
  readonly configPath?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly viteEnvironment: {
    readonly name: string;
    readonly childEnvironments: string[];
  };
}

interface WebViteConfigDependencies {
  readonly appRoot: string;
  readonly existsSync: (path: string) => boolean;
  readonly createVinext: () => PluginOption;
  readonly loadCloudflare: () => Promise<{
    readonly cloudflare: (options: CloudflarePluginOptions) => PluginOption;
  }>;
}

const realDependencies: WebViteConfigDependencies = {
  appRoot: fileURLToPath(new URL('.', import.meta.url)),
  existsSync,
  createVinext: vinext,
  loadCloudflare: () => import('@cloudflare/vite-plugin'),
};

export async function createWebViteConfig(
  _mode: string,
  dependencies: WebViteConfigDependencies = realDependencies,
): Promise<UserConfig> {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  const { cloudflare } = await dependencies.loadCloudflare();
  const shared = {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
  } satisfies UserConfig;

  const configBaseName = 'wrangler.owner-poc';
  const localConfigPath = path.join(
    dependencies.appRoot,
    `${configBaseName}.local.jsonc`,
  );
  const configPath = dependencies.existsSync(localConfigPath)
    ? localConfigPath
    : path.join(dependencies.appRoot, `${configBaseName}.jsonc`);
  return {
    ...shared,
    plugins: [
      dependencies.createVinext(),
      cloudflare({
        configPath,
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      }),
    ],
  };
}

export default defineConfig(({ mode }) => createWebViteConfig(mode));
