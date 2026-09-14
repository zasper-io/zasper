import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
The rules .eslintrc.json enabled, now applied to TypeScript too. ESLint 8, run as `eslint src`, linted
only .js files, so no .ts or .tsx source was ever checked. typescript-eslint's plugin is registered
without any of its rules, so that the `@typescript-eslint/...` disable comments in the source name rules
that exist.
*/
export default [
  { ignores: ['build/', 'public/', 'coverage/'] },
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    settings: { react: { version: 'detect' } },
  },
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs['recommended-latest'],
  prettierRecommended,
  {
    rules: {
      'react/prop-types': 'off',
      'react/display-name': 'off',
    },
  },
];
