import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const root = new URL('.', import.meta.url)

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@joinmap/gis-core': fileURLToPath(new URL('./packages/core/src/index.ts', root)),
      '@joinmap/adapter-ol': fileURLToPath(new URL('./packages/adapter-ol/src/index.ts', root)),
      '@joinmap/ui-vue': fileURLToPath(new URL('./packages/ui-vue/src/index.ts', root)),
      '@joinmap/ol-vue': fileURLToPath(new URL('./packages/ol-vue/src/index.ts', root)),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'jsdom',
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 10_000,
  },
})
