-- ============================================================
-- FIX: "new row violates row-level security policy" al subir fotos/PDF
-- Causa: el bucket "documentos" nunca tuvo políticas RLS en storage.objects.
-- Que un bucket sea "Public" solo habilita LECTURA anónima vía URL —
-- la escritura (insert) siempre pasa por RLS, con o sin ese flag.
-- ============================================================

create policy "usuarios_autenticados_suben_documentos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'documentos');

create policy "usuarios_autenticados_leen_documentos"
on storage.objects for select
to authenticated
using (bucket_id = 'documentos');
