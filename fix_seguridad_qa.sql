-- ============================================================
-- Correcciones de seguridad detectadas en la auditoría QA del
-- 2026-08-27. Cierra siete agujeros que hoy se controlan solo en el
-- navegador y que, por lo tanto, no controlan nada: cualquiera con la
-- clave pública (que va dentro del bundle) puede saltárselos llamando
-- a la API de Supabase directamente.
--
-- Este archivo es idempotente: se puede correr más de una vez sin
-- efectos secundarios.
--
-- IMPORTANTE — orden de aplicación: correr este script ANTES de
-- desplegar el código nuevo. Al revés también funciona, pero durante
-- la ventana entre ambos los usuarios inactivos seguirían entrando.
-- ============================================================


-- ============================================================
-- 0. Backfill defensivo
-- Si alguna fila quedó con estado NULL, el cambio del punto 1 la
-- dejaría fuera de la aplicación. Se normaliza antes de tocar nada.
-- ============================================================
update public.usuarios set estado = 'activo' where estado is null;


-- ============================================================
-- 1. El estado "inactivo" por fin significa algo
--
-- Hallazgo: la columna usuarios.estado existe y el tipo UserStatus
-- está declarado en TypeScript, pero NADA en la aplicación lo leía.
-- Desactivar a alguien no le quitaba ningún acceso.
--
-- En vez de agregar el chequeo en cada política (son más de treinta),
-- se corrige en la función que todas ellas ya usan: si el usuario no
-- está activo, usuario_rol_actual() devuelve NULL y ninguna política
-- lo reconoce. Un solo cambio cierra el acceso en todas las tablas a
-- la vez, incluidas las de Compras que se agreguen después.
-- ============================================================
create or replace function public.usuario_rol_actual()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.usuarios
  where id = auth.uid()
    and estado = 'activo';
$$;

grant execute on function public.usuario_rol_actual() to authenticated;


-- ============================================================
-- 2. SEG-1 / SEG-5 — Storage por carpeta y por rol
--
-- Antes: tres políticas que solo comprobaban bucket_id = 'documentos'.
-- Cualquier usuario autenticado (incluidos consultor y mandante) podía
-- subir con upsert sobre la ruta de un compilado ya aprobado y
-- reemplazar el PDF al que apunta un QR impreso y pegado en terreno.
-- Las rutas son predecibles y se arman en el cliente.
--
-- Carpetas que usa la aplicación (verificadas una por una en el código;
-- las firmas NO están acá, se sirven como archivos estáticos desde
-- public/firmas/, ver add_firma_usuarios.sql):
--   fotos/          CameraUpload.tsx:208     apr, supervisor, coordinador
--   pdfs/           CameraUpload.tsx:213     apr, supervisor, coordinador
--   compilados/     DocumentList.tsx:264     solo coordinador
--   partes-diarios/ ParteDiarioForm.tsx:373  apr, coordinador
--   compras/        (add_compras.sql)        consultor, coordinador
-- ============================================================

drop policy if exists "usuarios_autenticados_suben_documentos"      on storage.objects;
drop policy if exists "usuarios_autenticados_leen_documentos"       on storage.objects;
drop policy if exists "usuarios_autenticados_actualizan_documentos" on storage.objects;
drop policy if exists "documentos_leer"      on storage.objects;
drop policy if exists "documentos_escribir"  on storage.objects;
drop policy if exists "documentos_actualizar" on storage.objects;
drop policy if exists "documentos_borrar"    on storage.objects;

-- Quién puede escribir en cada carpeta. Se usa en las tres políticas de
-- escritura de abajo para no repetir la lógica.
create or replace function public.puede_escribir_en_carpeta(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case split_part(p_ruta, '/', 1)
    when 'fotos'          then public.usuario_rol_actual() in ('coordinador', 'apr', 'supervisor')
    when 'pdfs'           then public.usuario_rol_actual() in ('coordinador', 'apr', 'supervisor')
    when 'partes-diarios' then public.usuario_rol_actual() in ('coordinador', 'apr')
    when 'compilados'     then public.usuario_rol_actual() = 'coordinador'
    when 'compras'        then public.usuario_rol_actual() in ('coordinador', 'consultor')
    -- Carpeta desconocida: se niega. Si mañana se agrega una carpeta
    -- nueva en el código, hay que sumarla acá o las subidas fallarán.
    else false
  end;
$$;

grant execute on function public.puede_escribir_en_carpeta(text) to authenticated;

-- Lectura: cualquier usuario activo. El bucket es público para lectura
-- por URL de todas formas (así funcionan los QR), así que restringir
-- esto no aportaría seguridad, solo rompería la app.
create policy "documentos_leer" on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos' and public.usuario_rol_actual() is not null);

create policy "documentos_escribir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos' and public.puede_escribir_en_carpeta(name));

-- upsert = insert + update, por eso subirCompilado y reemplazarArchivo
-- necesitan ambas (ver fix_storage_update_policy.sql).
create policy "documentos_actualizar" on storage.objects
  for update to authenticated
  using      (bucket_id = 'documentos' and public.puede_escribir_en_carpeta(name))
  with check (bucket_id = 'documentos' and public.puede_escribir_en_carpeta(name));

-- SEG-5: no existía ninguna política de delete, así que el borrado de
-- archivos fallaba en silencio (supabase.ts se tragaba el error) y los
-- archivos quedaban accesibles por su URL pública para siempre, ya sin
-- ninguna fila que los referenciara.
create policy "documentos_borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos' and public.usuario_rol_actual() = 'coordinador');


-- ============================================================
-- 3. SEG-2 — Un APR ya no puede auto-aprobar sus documentos
--
-- Antes: la política solo validaba rol y autor. El estado 'pendiente'
-- se fijaba únicamente en el cliente (CameraUpload.tsx:226), así que
-- un POST directo con estado='aprobado' y aprobado_por apuntando al
-- coordinador entraba sin objeción, y ese documento viajaba al
-- compilado del día sin que nadie lo hubiera revisado.
-- ============================================================
drop policy if exists "apr_supervisor_crear" on public.documentos;
create policy "apr_supervisor_crear" on public.documentos
  for insert with check (
    public.usuario_rol_actual() in ('apr', 'supervisor')
    and creado_por = auth.uid()
    and estado = 'pendiente'
    and aprobado_por is null
  );


-- ============================================================
-- 4. SEG-3 — El mandante solo puede comentar
--
-- Antes: su política de update no restringía columnas, así que la
-- contraparte comercial podía modificar mano de obra, maquinaria y HH
-- acumuladas de un reporte ya enviado — los números sobre los que se
-- factura — sin dejar rastro. El propio comentario de
-- add_partes_diarios.sql:154 reconocía la simplificación.
--
-- Las columnas permitidas son exactamente las que envía
-- db.comentarComoMandante() (supabase.ts:453). Cualquier otra genera
-- un error explícito en vez de aplicarse en silencio.
-- ============================================================
create or replace function public.mandante_solo_comenta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.usuario_rol_actual() is distinct from 'mandante' then
    return new;
  end if;

  if (new.contrato_id, new.numero_reporte, new.fecha, new.faena,
      new.condicion_climatica, new.actividades, new.mano_obra_directa,
      new.mano_obra_indirecta, new.maquinaria, new.jornada,
      new.hh_directas_programado, new.hh_indirectas_programado,
      new.hh_directas_acumuladas, new.hm_acumuladas,
      new.hh_indirectas_acumuladas, new.fotos,
      new.comentario_contratista_autor, new.comentario_contratista,
      new.excel_url, new.creado_por)
     is distinct from
     (old.contrato_id, old.numero_reporte, old.fecha, old.faena,
      old.condicion_climatica, old.actividades, old.mano_obra_directa,
      old.mano_obra_indirecta, old.maquinaria, old.jornada,
      old.hh_directas_programado, old.hh_indirectas_programado,
      old.hh_directas_acumuladas, old.hm_acumuladas,
      old.hh_indirectas_acumuladas, old.fotos,
      old.comentario_contratista_autor, old.comentario_contratista,
      old.excel_url, old.creado_por)
  then
    raise exception 'El mandante solo puede agregar su comentario, no modificar el contenido del reporte';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mandante_solo_comenta on public.partes_diarios;
create trigger trg_mandante_solo_comenta
  before update on public.partes_diarios
  for each row execute function public.mandante_solo_comenta();


-- ============================================================
-- 5. SEG-4 — La bitácora deja de aceptar registros inventados
--
-- Antes: "for insert with check (true)" SIN cláusula "to", así que la
-- política alcanzaba también al rol anónimo. Como la clave pública va
-- dentro del bundle, cualquiera podía fabricar entradas del tipo
-- "documento X aprobado por el coordinador" y el historial dejaba de
-- servir como evidencia.
-- ============================================================
drop policy if exists "todos_insertar_historial" on public.historial;
create policy "usuarios_insertan_historial_propio" on public.historial
  for insert to authenticated
  with check (
    public.usuario_rol_actual() is not null
    and usuario_id = auth.uid()
  );


-- ============================================================
-- 6. DAT-4 — El QR deja de servir el PDF viejo
--
-- add_cache_compilados.sql creó políticas de select, insert y update,
-- pero no de delete. Sin ella PostgREST no devuelve error: filtra las
-- filas, no borra ninguna y responde que borró cero, así que el catch
-- de invalidarCompiladoDia() nunca se disparaba. La fila de caché
-- sobrevivía, se consideraba vigente, y el compilado que se repartía
-- al mandante seguía conteniendo el documento eliminado.
-- ============================================================
drop policy if exists "coordinador_eliminar_compilados" on public.compilados_dia;
create policy "coordinador_eliminar_compilados" on public.compilados_dia
  for delete using (public.usuario_rol_actual() = 'coordinador');


-- ============================================================
-- 7. Toda cuenta nueva nace inactiva
--
-- El auto-registro (add_registro_usuarios.sql) es intencional y fuerza
-- rol='consultor'. El problema es que consultor hoy tiene acceso de
-- escritura al módulo de Compras, así que cualquiera que se registre
-- entra directo. Con este cambio la cuenta se crea inactiva y —gracias
-- al punto 1— no tiene ningún acceso hasta que el coordinador la
-- habilite desde Gestión de Usuarios.
-- ============================================================
drop policy if exists "usuarios_crear_propio" on public.usuarios;
create policy "usuarios_crear_propio" on public.usuarios
  for insert
  with check (
    auth.uid() = id
    and rol = 'consultor'
    and estado = 'inactivo'
  );

-- Cinturón y tirantes: aunque alguien inserte la fila por otra vía, el
-- trigger la fuerza a inactiva. Solo aplica al alta; no interfiere con
-- que el coordinador la active después (eso es un UPDATE).
create or replace function public.usuario_nuevo_inactivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- El coordinador sí puede crear usuarios ya activos desde el panel.
  if public.usuario_rol_actual() = 'coordinador' then
    return new;
  end if;
  new.estado := 'inactivo';
  return new;
end;
$$;

drop trigger if exists trg_usuario_nuevo_inactivo on public.usuarios;
create trigger trg_usuario_nuevo_inactivo
  before insert on public.usuarios
  for each row execute function public.usuario_nuevo_inactivo();


-- ============================================================
-- Después de correr esto, verificar en Supabase:
--   1. Subir un documento como APR  → debe funcionar.
--   2. Generar el QR del día como coordinador → debe funcionar.
--   3. Guardar un Daily Report con fotos como APR → debe funcionar.
--   4. Marcar un usuario como inactivo en Gestión de Usuarios → esa
--      persona debe quedar sin acceso al recargar.
-- Si alguna subida falla con "new row violates row-level security
-- policy", es que hay una carpeta que no está en
-- puede_escribir_en_carpeta() — agregarla ahí.
-- ============================================================
