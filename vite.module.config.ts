import { defineConfig } from 'vite'
export default defineConfig({
  // MediaPipe loads its WASM JS at runtime. Preserve that intent for downstream
  // bundlers (Next/Turbopack), which otherwise try to resolve the variable URL.
  plugins: [{ name: 'mediapipe-runtime-import', renderChunk(code) {
    return { code: code.replace(/import\((\w+\.toString\(\))\)/g,
      'import(/* webpackIgnore: true */ $1)'), map: null }
  } }],
  worker: { format: 'es' },
  build: {
    outDir: 'dist-module',
    lib: { entry: 'src/ring-feet-module.tsx', formats: ['es'], fileName: () => 'index.js' },
  },
})
