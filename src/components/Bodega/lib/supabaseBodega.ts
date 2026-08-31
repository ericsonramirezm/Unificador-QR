import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// TEMPORAL Fase 1-2: conecta al Supabase VIEJO de Bodega. Se reemplaza en
// Fase 3 por el cliente de Unificador-QR (`@lib/supabase.ts`), una vez que el
// esquema y los datos de negocio se hayan migrado al proyecto de
// Unificador-QR (`tfzmikazcxrttvevbcco`). Hardcodeado a propósito, en vez de
// leerlo de variables de entorno: este cliente es aislado y desechable, y no
// tiene sentido pedirle a Unificador-QR que declare `VITE_SUPABASE_URL`/
// `VITE_SUPABASE_ANON_KEY` de un proyecto que va a dejar de usarse. Los
// valores salen de `Bodega/bodega-app/.env` (solo lectura, no se toca).
const BODEGA_URL_VIEJA = 'https://jmvgtlwrlpidovotvlfr.supabase.co'
const BODEGA_ANON_KEY_VIEJA =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imptdmd0bHdybHBpZG92b3R2bGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMTgyNjMsImV4cCI6MjEwMTU5NDI2M30.R5mTc_2e3vcwtGv5SuURMi34a0p9APAZeHYjAI_XYjA'

let cliente: SupabaseClient | null = null

/**
 * Cliente perezoso, propio y separado del `@lib/supabase.ts` de
 * Unificador-QR — no comparte sesión ni configuración con él. En esta fase no
 * hay login propio de Bodega (`pages/Login.tsx` no se portó: Unificador-QR ya
 * tiene el suyo), así que las peticiones viajan sin sesión autenticada contra
 * este proyecto — cualquier lectura protegida por RLS que exija rol
 * `authenticated` puede volver vacía o con "permission denied" hasta que la
 * Fase 3/4 resuelva el login único. Es una limitación conocida de esta fase,
 * no un bug.
 */
export function obtenerSupabaseBodega(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(BODEGA_URL_VIEJA, BODEGA_ANON_KEY_VIEJA, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Storage key distinto del de Bodega standalone y del de
        // Unificador-QR: los tres pueden convivir en el mismo navegador sin
        // pisarse la sesión.
        storageKey: 'bodega-wilug-temporal-auth',
      },
    })
  }
  return cliente
}
