import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption, type UserConfig } from 'vite';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

interface HostingConfig {
  readonly d1?: string;
  readonly r2?: string;
}

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
  readonly loadSites: () => Promise<{
    readonly sites: () => PluginOption;
  }>;
  readonly loadHostingConfig: () => Promise<HostingConfig>;
}

const realDependencies: WebViteConfigDependencies = {
  appRoot: fileURLToPath(new URL('.', import.meta.url)),
  existsSync,
  createVinext: vinext,
  loadCloudflare: () => import('@cloudflare/vite-plugin'),
  loadSites: () => import('@openai/sites-vite-plugin'),
  async loadHostingConfig() {
    const loaded = await import('./.openai/hosting.json', {
      with: { type: 'json' },
    });
    return loaded.default;
  },
};

export async function createWebViteConfig(
  mode: string,
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

  if (mode === 'agent-poc') {
    const localConfigPath = path.join(
      dependencies.appRoot,
      'wrangler.agent-poc.local.jsonc',
    );
    const configPath = dependencies.existsSync(localConfigPath)
      ? localConfigPath
      : path.join(dependencies.appRoot, 'wrangler.agent-poc.jsonc');
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

  const [{ sites }, hostingConfig] = await Promise.all([
    dependencies.loadSites(),
    dependencies.loadHostingConfig(),
  ]);
  const { d1, r2 } = hostingConfig;
  const localBindingConfig = {
    main: 'vinext/server/fetch-handler',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: 'site-creator-d1',
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: 'site-creator-r2',
          },
        ]
      : [],
  };

  return {
    ...shared,
    plugins: [
      dependencies.createVinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
}

export default defineConfig(({ mode }) => createWebViteConfig(mode));
