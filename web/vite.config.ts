import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA dev server proxies REST + WS to the Node backend (default :8787).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
