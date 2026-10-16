import { defineConfig } from 'vitest/config';

/**
 * One test runner, one kind of test.
 *
 * CLAUDE.md (M5) allows tests exactly two seams into the system: the real booted app's edge,
 * and the Clock plus a single sweep entry point. Neither is a unit test of a service, so
 * there is no separate "unit" vs "e2e" project here — everything lives under test/ and goes
 * in through HTTP or a websocket. That is also why the generated vitest.config.e2e.ts from
 * the NestJS starter is absent: a second config would invite a second kind of test.
 */
export default defineConfig({
  // Resolves the path aliases in tsconfig.json. The NestJS starter uses the
  // vite-tsconfig-paths plugin for this; Vite supports it natively now and says so on every
  // run, so the plugin is gone.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.spec.ts'],
    setupFiles: ['./test/helpers/test-env.ts'],
    // Applies migrations to the test database once, before any file runs. A test that fails
    // with "relation does not exist" reads as broken code, not a stale database.
    globalSetup: ['./test/helpers/global-setup.ts'],
    // Every test talks to one real Postgres and truncates between cases (see
    // test/helpers/database.ts). Parallel files would interleave those truncations and the
    // failures would look like flakes rather than the isolation bug they are.
    fileParallelism: false,
    // Booting Nest and connecting to Postgres costs more than the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // A spy that outlives its test is the worst kind of failure: the test that set it
    // passes, and an unrelated one three files away fails for no visible reason. Vitest does
    // not restore spies by default, so this is on deliberately.
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
      reportsDirectory: 'coverage',
    },
  },
});
