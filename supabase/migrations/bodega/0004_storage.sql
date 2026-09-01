-- =============================================================================
-- 0004 — Almacenamiento de las guías de despacho escaneadas
-- =============================================================================
-- Sin cambios respecto del original de Bodega: el bucket `guias` no colisiona
-- con nada de Unificador-QR (su bucket de documentos, si existe, tiene otro
-- id) y las políticas usan `puede_mover()`/`es_admin()`, que ya apuntan a
-- `usuarios.rol_bodega` desde 0001.
--
-- Bucket PRIVADO: los archivos se sirven con URLs firmadas de corta vida, nunca
-- por una URL pública adivinable. Una guía de despacho trae RUT del proveedor,
-- precios y direcciones — no es material para dejar accesible a internet.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'guias', 'guias', false,
  10485760, -- 10 MB: una foto de celular o un PDF escaneado caben de sobra
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create policy "leer guias" on storage.objects
  for select to authenticated
  using (bucket_id = 'guias');

create policy "subir guias" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'guias' and puede_mover());

-- Reemplazar un escaneo mal tomado es legítimo; borrarlo sin dejar rastro no.
create policy "reemplazar guias" on storage.objects
  for update to authenticated
  using (bucket_id = 'guias' and puede_mover())
  with check (bucket_id = 'guias' and puede_mover());

create policy "borrar guias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'guias' and es_admin());
