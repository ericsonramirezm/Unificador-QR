import { defineConfig } from 'vitest/config'
import path from 'path'

// Configuración de pruebas separada de vite.config.ts a propósito: así el
// archivo de build no se toca (hoy tiene cambios de PWA en curso) y las
// pruebas no arrastran plugins que no necesitan.
//
// Los alias tienen que repetirse acá porque vitest.config.ts reemplaza a
// vite.config.ts, no lo extiende.
export default defineConfig({
  test: {
    // Las pruebas actuales son de funciones puras (cálculos de HH y
    // traducción de errores), así que no hace falta un DOM simulado. Si más
    // adelante se prueban componentes, acá va environment: 'jsdom'.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@lib': path.resolve(__dirname, './src/lib'),
    },
  },
})
