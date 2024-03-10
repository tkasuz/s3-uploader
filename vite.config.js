import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: "./",
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'index',
      fileName: 'index',
    },
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      name: 'chrome', 
    },
    include: ["tests/**/*.test.ts"]
  }
})