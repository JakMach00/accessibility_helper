import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Bundles the CLI into a single ESM file. Heavy dependencies (playwright, axe-core)
// stay external and are loaded from node_modules at runtime.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'src/cli/index.ts')],
  outfile: resolve(root, 'dist-cli/wcag-audit.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['playwright', 'playwright-core', 'electron', 'axe-core'],
  banner: { js: '#!/usr/bin/env node' },
  alias: {
    '@shared': resolve(root, 'src/shared'),
    '@core': resolve(root, 'src/core'),
    '@infra': resolve(root, 'src/infrastructure')
  },
  logLevel: 'info'
});

process.stdout.write('CLI built: dist-cli/wcag-audit.mjs\n');
