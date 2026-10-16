// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'eslint.config.mjs',
      'temp_recovery/**',
      '_probe/**',
      'prisma/**',
      '*.js',
      '*.cjs',
      '*.mjs',
      'check.ts',
      'seed-dev-users.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md: "ไม่มี `any` ที่ไม่ได้อธิบายเหตุผลไว้". These stay errors so that the only
      // way past them is an inline disable comment carrying the reason — which is exactly
      // the "explain why" the rule asks for.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // A floating promise in a request handler is a silently dropped failure.
      '@typescript-eslint/no-floating-promises': 'error',

      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Seam 2 (M5) only works if there is exactly one way to read the clock. A convention in a
    // document does not survive eleven topics; this does.
    //
    // The three clocks in this system run for 24h, 24h and 3 days, and a reservation has to
    // survive all of them. One stray `new Date()` makes that path untestable, and it will be
    // found by a user hitting a deadline rather than by a test.
    //
    // src/time/system-clock.ts disables this inline — it is the single place allowed to read the
    // wall clock. A second file asking for the same exemption means something is bypassing the
    // seam, not that the rule is inconvenient.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message:
            'Inject Clock and call clock.now() instead of `new Date()`. Seam 2 (M5) needs one source of time, or nothing about the three clocks is testable. Parsing a known string — new Date(isoFromDb) — is fine.',
        },
        {
          selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message:
            'Inject Clock and call clock.nowMs() instead of `Date.now()`. See M5 in CLAUDE.md.',
        },
      ],
    },
  },
);
