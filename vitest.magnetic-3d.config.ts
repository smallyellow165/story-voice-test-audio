import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { environment: 'node', include: ['checks/magnetic-3d/**/*.vitest.ts'] } })
