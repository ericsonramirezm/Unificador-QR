import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild'
  },
  worker: {
    // El worker de OpenCV.js (ver src/lib/opencv.worker.ts) usa
    // importScripts() para cargar el UMD del paquete, igual que el <script>
    // que se usa en el hilo principal (ver opencv.ts) — importScripts solo
    // existe en workers "clásicos", no en workers de módulo, así que se fija
    // el formato explícitamente en vez de depender del valor por defecto.
    format: 'iife'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@lib': path.resolve(__dirname, './src/lib')
    }
  }
})
