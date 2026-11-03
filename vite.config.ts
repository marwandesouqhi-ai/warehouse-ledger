import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // PGlite's WASM optimizer exhausts compiler memory on Windows; baseline WASM is sufficient for SQL tests.
    execArgv: process.platform === 'win32' ? ['--liftoff-only'] : [],
    maxWorkers: process.platform === 'win32' ? 1 : undefined,
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
