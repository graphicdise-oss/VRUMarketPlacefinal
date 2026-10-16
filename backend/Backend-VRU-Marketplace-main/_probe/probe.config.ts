import { defineConfig } from 'vitest/config';

// Same wiring as vitest.config.ts (globalSetup + setupFiles) but with ONE harmless spec that
// only prints the database NAME the suite would use. It never boots the app and never truncates.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['_probe/*.spec.ts'],
    setupFiles: ['./test/helpers/test-env.ts'],
    globalSetup: ['./test/helpers/global-setup.ts'],
    fileParallelism: false,
  },
});
