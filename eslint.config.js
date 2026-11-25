import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

const typescript = ['**/*.{ts,cts,mts}', '**/*.vue'];

export default defineConfig([
  globalIgnores(['**/.pnpm-store/**', '**/dist/**', '**/dist-types/**', '**/coverage/**']),
  {
    files: ['**/*.{js,cjs,mjs,ts,cts,mts,vue}'],
    extends: [js.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: typescript,
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser },
      globals: globals.browser,
    },
  },
  {
    files: [
      'packages/ui-vue/src/components/Legend.vue',
      'packages/ui-vue/src/components/Tooltip.vue',
      'packages/ui-vue/src/panels/Toolbar.vue',
    ],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    files: ['examples/*/src/**/*.{js,cjs,mjs}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.config.{js,cjs,mjs,ts,cts,mts}', '**/test/**/*.{js,cjs,mjs,ts,cts,mts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/core/src/**/*.{js,cjs,mjs,ts,cts,mts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:vue|ol|@vue/[^/]+)(?:/|$)',
              message: 'Keep Core independent of Vue and OpenLayers.',
            },
            {
              regex: '^(?:@joinmap/|(?:\\.{1,2}/)+)(?:adapter-ol|ui-vue|ol-vue)(?:/|$)',
              message: 'Keep Core independent of adapter and UI packages.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui-vue/src/**/*.{js,cjs,mjs,ts,cts,mts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:ol|(?:@joinmap/|(?:\\.{1,2}/)+)(?:adapter-ol|ol-vue))(?:/|$)',
              message: 'Use the public Core API for map capabilities in ui-vue.',
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
