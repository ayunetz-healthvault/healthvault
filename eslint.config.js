// https://docs.expo.dev/guides/using-eslint/
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // `backend/` is a separate package with its own TypeScript, ESLint and test
    // setup — see backend/README.md for why the boundary is deliberate.
    ignores: [
      'dist/*',
      'node_modules/*',
      '.expo/*',
      'android/*',
      'ios/*',
      'coverage/*',
      'backend/*',
      // Evidence artefacts, not application source: the capture scripts are
      // meant to print to a terminal, and they are kept as-run so the images
      // in the same directory can be reproduced exactly.
      'docs/koode/evidence/*',
    ],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': typescriptPlugin },
    rules: {
      // A leading underscore is the project's "deliberately unused" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'jest.setup.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]);
