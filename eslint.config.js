import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/lib/**',
      '**/.firebase/**',
      '**/coverage/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['apps/functions/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/functions/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // E2E Playwright (B20): corren en Node, no en el navegador. Añaden globals
    // de node (process, fetch) sobre el bloque apps/web/** anterior.
    files: ['apps/web/e2e/**/*.ts', 'apps/web/playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
];
