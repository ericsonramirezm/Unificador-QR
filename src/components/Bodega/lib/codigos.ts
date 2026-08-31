/**
 * Normalización del Código Defontana.
 *
 * Vive en su propio módulo, sin depender del cliente de Supabase, por dos razones:
 * es una función pura que no tiene nada que hacer en la capa de datos, y así el
 * lector de planillas puede ejercitarse desde Node sin arrastrar credenciales.
 *
 * **Espeja EXACTAMENTE el trigger `normalizar_codigo_defontana` de Postgres**
 * (`upper(trim(...))`). Si las dos se separan, la vista previa de la
 * importación miente sobre qué códigos están duplicados: mostraría como nuevo
 * algo que la base va a rechazar, o al revés.
 */
export const normalizarCodigo = (codigo: string) => codigo.trim().toUpperCase()
