import eslintConfigPrettier from 'eslint-config-prettier'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'demo/public/**'],
  },
  {
    name: 'app/runtime-globals',
    files: ['**/*.{ts,mts,vue}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
  },
  {
    name: 'app/tooling-globals',
    files: [
      'eslint.config.js',
      '**/vite.config.ts',
      '**/vitest.config.ts',
      'packages/*/test/**/*.ts',
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  {
    name: 'app/no-unused-vars',
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  eslintConfigPrettier,
)
