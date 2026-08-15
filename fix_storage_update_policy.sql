-- ============================================================
-- FIX: falta política de UPDATE en storage.objects para el bucket
-- "documentos". La política de INSERT ya existente cubre subir un
-- archivo nuevo, pero el compilado del día se sube con upsert:true
-- (se regenera y REEMPLAZA si ya existía), y eso requiere también
-- permiso de UPDATE — si no, funcionaría la primera vez que se
-- genera el compilado de un día, y fallaría la segunda.
-- ============================================================

create policy "usuarios_autenticados_actualizan_documentos"
on storage.objects for update
to authenticated
using (bucket_id = 'documentos')
with check (bucket_id = 'documentos');
