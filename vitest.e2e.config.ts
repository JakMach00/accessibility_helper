import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Testy E2E uruchamiaja realne Chromium. Sa oddzielone od testow jednostkowych
// (te matchuja tylko *.test.ts), aby "npm test" pozostal szybki i bez przegladarki.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@infra': resolve(__dirname, 'src/infrastructure')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.e2e.ts'],
    globals: false,
    testTimeout: 60000,
    hookTimeout: 60000
  }
});
