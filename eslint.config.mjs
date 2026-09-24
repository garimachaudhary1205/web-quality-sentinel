import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config (ESLint 9). TypeScript rules + Prettier compatibility.
 * We keep the rule set pragmatic: catch real bugs, don't fight formatting
 * (Prettier owns that).
 */
export default tseslint.config(
  {
    ignores: ['node_modules', 'dist', 'playwright-report', 'test-results', 'public', 'history'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  prettier,
);
