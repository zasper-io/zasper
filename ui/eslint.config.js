import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
The rules .eslintrc.json enabled, now applied to TypeScript too. ESLint 8, run as `eslint src`, linted
only .js files, so no .ts or .tsx source was ever checked. typescript-eslint's plugin is registered
without any of its rules, so that the `@typescript-eslint/...` disable comments in the source name rules
that exist.
*/

/*
jsx-a11y's recommended rules, as warnings until what they find today is fixed (todos/accessibility.md);
each then goes back to an error. Two are off:
- label-has-associated-control calls minimatch's default export, which the minimatch 11 override in
  package.json does not have, and every 3.x is inside GHSA-g3hv-75wg-m249. axe's `label` rule in
  e2e/tests/a11y.spec.ts covers the same ground at runtime meanwhile.
- no-autofocus flags every dialog, popup and rename box taking focus when the user opens it, which is
  the focus management the dialog and menu patterns ask for.
*/
const a11yWarnings = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([rule, setting]) => {
    const [level, ...options] = Array.isArray(setting) ? setting : [setting];
    return [rule, level === 'off' ? 'off' : ['warn', ...options]];
  })
);

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
  { ...jsxA11y.flatConfigs.recommended, rules: a11yWarnings },
  prettierRecommended,
  {
    rules: {
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/no-autofocus': 'off',
    },
  },
];
