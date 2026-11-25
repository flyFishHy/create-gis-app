import { defineConfig } from 'eslint/config';
import baseConfig from './eslint.config.js';

export default defineConfig([
  ...baseConfig,
  {
    files: ['packages/*/src/**/*.{js,cjs,mjs,ts,cts,mts,vue}'],
    rules: {
      complexity: ['warn', 20],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
      'no-nested-ternary': 'warn',
      'no-multi-assign': 'error',
      'no-param-reassign': ['error', { props: false }],
      'id-length': ['error', { min: 2, max: 30, properties: 'never' }],
      camelcase: ['error', { properties: 'never' }],
      semi: ['error', 'always'],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-loop-func': 'error',
      'no-shadow': 'error',
      'max-params': ['warn', 5],
    },
  },
  {
    files: ['packages/*/src/**/*.{ts,cts,mts,vue}'],
    rules: {
      'no-loop-func': 'off',
      '@typescript-eslint/no-loop-func': 'error',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'max-params': 'off',
      '@typescript-eslint/max-params': ['warn', { max: 5 }],
    },
  },
]);
