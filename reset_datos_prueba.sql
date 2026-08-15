-- ============================================================
-- RESET de datos de prueba — borra TODO lo transaccional para
-- empezar a probar desde cero.
--
-- Se mantienen intactos: usuarios (public.usuarios + Auth) y contratos
-- (incluye mandante/nombre que acabamos de configurar).
--
-- Se borran: documentos, historial de auditoría, secuencias de
-- numeración de PDF, y el caché de compilados por día.
--
-- Esto NO borra los archivos ya subidos a Storage (fotos, PDFs,
-- compilados) — eso se limpia aparte, ver instrucciones.
-- ============================================================

truncate table
  public.historial,
  public.documentos,
  public.secuencias_pdf,
  public.compilados_dia
cascade;
