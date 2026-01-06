import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/commander'),
  server: {
    port: 3848,
    strictPort: true,
    host: '127.0.0.1',
    open: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/commander'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
