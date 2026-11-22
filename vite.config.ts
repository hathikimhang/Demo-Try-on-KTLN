import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()], worker: { format: 'es' },
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
  server: { watch: { ignored: ['**/*.test.ts', '**/artifacts/**', '**/docs/**', '**/tsconfig.tsbuildinfo'] } },
  build: { rollupOptions: { output: { manualChunks: { three: ['three', 'three/addons/environments/RoomEnvironment.js'] } } } },
});
