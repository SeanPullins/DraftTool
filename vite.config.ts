import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/DraftTool/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
