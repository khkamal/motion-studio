import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Arena previews are served through an e2b.app hostname.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    target: 'ES2020',
    sourcemap: true,
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(webRoot, './src'),
      '@components': path.resolve(webRoot, './src/components'),
      '@features': path.resolve(webRoot, './src/features'),
      '@engine': path.resolve(webRoot, './src/engine'),
      '@store': path.resolve(webRoot, './src/store'),
      '@types': path.resolve(webRoot, './src/types'),
      '@hooks': path.resolve(webRoot, './src/hooks'),
      '@lib': path.resolve(webRoot, './src/lib'),
    },
  },
});
