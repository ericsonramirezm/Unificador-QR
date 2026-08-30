-- ============================================================
-- Módulo "Compras" — Solicitud de Compra (SC) → Requisición (RQ) →
-- Orden de Compra (OC), como tres tablas separadas por etapa
-- (decisión final tras revertir el diseño de "misma fila que se va
-- completando"). Cada ítem que avanza de etapa genera una fila NUEVA
-- en la tabla siguiente, copiando los datos heredados; la fila de la
-- etapa anterior NO se borra, solo se oculta del listado
-- (avanzo_a_rq / avanzo_a_oc = true) para conservar la trazabilidad
-- completa desde la solicitud hasta la compra final.
--
-- Independiente de las tablas de Documentos QR y Daily Report; solo
-- comparte "usuarios" y "contratos", que ya existen. Reutiliza el
-- bucket de Storage "documentos" ya creado (mismas políticas de
-- fix_storage_rls.sql), bajo la carpeta compras/<contrato_id>/<codigo_sc>/.
-- ============================================================

-- ---------- secuencia atómica para "Código SC" ----------
-- Mismo patrón que secuencias_pdf (migraciones_fix_bugs.sql): un solo
-- upsert atómico evita colisiones si dos coordinadores crean una SC al
-- mismo tiempo. A diferencia de partes_diarios (correlativo por fecha),
-- acá el correlativo es continuo por contrato: SC-0001, SC-0002, ...
create table if not exists public.secuencias_sc (
  contrato_id uuid primary key references public.contratos(id) on delete cascade,
  ultimo_valor int not null default 0
);

alter table public.secuencias_sc enable row level security;
-- Sin políticas propias: solo se accede a través de la función de abajo (SECURITY DEFINER).

create or replace function public.obtener_siguiente_codigo_sc(p_contrato_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valor int;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'consultor') then
    raise exception 'No autorizado';
  end if;

  insert into public.secuencias_sc (contrato_id, ultimo_valor)
  values (p_contrato_id, 1)
  on conflict (contrato_id)
  do update set ultimo_valor = secuencias_sc.ultimo_valor + 1
  returning ultimo_valor into v_valor;

  return 'SC-' || lpad(v_valor::text, 4, '0');
end;
$$;

grant execute on function public.obtener_siguiente_codigo_sc(uuid) to authenticated;

-- ---------- Solicitudes de Compra (SC) ----------
-- Una fila por ítem (no por envío del formulario). Todos los ítems de
-- un mismo envío de "Nueva Solicitud de Compra" comparten el mismo
-- codigo_sc y se numeran 1..N en numero_item.
--
-- Orden de columnas aprobado: N° | Código SC | Solicitado por |
-- Fecha de solicitud | Documento de respaldo | Descripción | Marca |
-- Modelo | Cantidad | Unidad
create table if not exists public.solicitudes_compra (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),

  codigo_sc text not null,
  numero_item int not null,

  -- Texto libre: quien pide el material puede ser distinto de quien
  -- crea el registro (ej. un supervisor pide verbalmente y el
  -- coordinador lo ingresa).
  solicitado_por text not null,
  fecha_solicitud date not null default current_date,

  -- El documento de respaldo vive SOLO acá — no se copia a RQ ni OC.
  documento_url text,
  documento_nombre text,

  descripcion text not null,
  marca text,
  modelo text,
  cantidad numeric not null,
  unidad text,

  -- true = ya se generó su fila en "requisiciones"; se oculta de este
  -- listado pero el registro se conserva para trazabilidad.
  avanzo_a_rq boolean not null default false,

  creado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (contrato_id, codigo_sc, numero_item)
);

create index if not exists idx_solicitudes_compra_contrato
  on public.solicitudes_compra (contrato_id, avanzo_a_rq, created_at desc);

-- ---------- Requisiciones (RQ) ----------
-- Orden de columnas aprobado: RQ N° | Fecha de RQ | Código Defontana |
-- Solicitud de Compra | Solicitado por | N° | Descripción | Marca |
-- Modelo | Cantidad | Unidad
create table if not exists public.requisiciones (
  id uuid primary key default gen_random_uuid(),

  -- Origen, para trazabilidad y para que "Devolver" sepa a qué fila de
  -- SC hay que reactivar.
  solicitud_compra_id uuid not null references public.solicitudes_compra(id),
  contrato_id uuid not null references public.contratos(id),

  -- Heredado de SC al momento de avanzar (snapshot, no se vuelve a
  -- leer de solicitudes_compra después).
  codigo_sc text not null,
  solicitado_por text not null,
  numero_item int not null,
  descripcion text not null,
  marca text,
  modelo text,
  cantidad numeric not null,
  unidad text,

  -- Propios de RQ: llegan en blanco ("por llenar" en la UI) y se
  -- completan a mano en la pestaña RQ.
  rq_numero text,
  fecha_rq date,
  codigo_defontana text,

  -- true = ya se generó su fila en "ordenes_compra"; se oculta de este
  -- listado pero el registro se conserva.
  avanzo_a_oc boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (solicitud_compra_id)
);

create index if not exists idx_requisiciones_contrato
  on public.requisiciones (contrato_id, avanzo_a_oc, created_at desc);
-- Buscador propio de RQ: coincidencia exacta por RQ N°.
create index if not exists idx_requisiciones_rq_numero
  on public.requisiciones (rq_numero);

-- ---------- Órdenes de Compra (OC) ----------
-- Orden de columnas aprobado: OC | RQ N° | Fecha de RQ | Código
-- Defontana | Solicitud de Compra | Solicitado por | N° | Descripción
-- | Marca | Modelo | Cantidad | Unidad
create table if not exists public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),

  requisicion_id uuid not null references public.requisiciones(id),
  contrato_id uuid not null references public.contratos(id),

  -- Heredado de RQ (que a su vez lo heredó de SC) al momento de avanzar.
  rq_numero text,
  fecha_rq date,
  codigo_defontana text,
  codigo_sc text not null,
  solicitado_por text not null,
  numero_item int not null,
  descripcion text not null,
  marca text,
  modelo text,
  cantidad numeric not null,
  unidad text,

  -- Propio de OC: llega en blanco ("por llenar") y se completa a mano.
  oc_numero text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (requisicion_id)
);

create index if not exists idx_ordenes_compra_contrato
  on public.ordenes_compra (contrato_id, created_at desc);
-- Buscador propio de OC: coincidencia exacta por su propio N° de OC.
create index if not exists idx_ordenes_compra_oc_numero
  on public.ordenes_compra (oc_numero);

-- ---------- Avanzar de etapa (botón "Pasar a RQ →" / "Pasar a OC →") ----------
-- Reciben un arreglo de ids para soportar tanto una fila sola como
-- selección en lote. Cada función: (1) marca avanzo_* = true en el
-- origen SOLO si todavía no había avanzado (evita duplicar si se hace
-- doble clic o se repite la llamada), (2) inserta la fila nueva
-- copiando los datos heredados con los campos propios en blanco,
-- (3) devuelve los ids nuevos creados. Todo en una sola función =
-- una sola transacción, no puede quedar a medias.

create or replace function public.avanzar_sc_a_rq(p_item_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_sc record;
  v_nuevo_id uuid;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'consultor') then
    raise exception 'No autorizado';
  end if;

  foreach v_id in array p_item_ids loop
    update public.solicitudes_compra
       set avanzo_a_rq = true, updated_at = now()
     where id = v_id and avanzo_a_rq = false
    returning * into v_sc;

    if v_sc.id is null then
      continue; -- ya estaba avanzado (o no existe): se ignora, no se duplica
    end if;

    insert into public.requisiciones (
      solicitud_compra_id, contrato_id, codigo_sc, solicitado_por,
      numero_item, descripcion, marca, modelo, cantidad, unidad
    ) values (
      v_sc.id, v_sc.contrato_id, v_sc.codigo_sc, v_sc.solicitado_por,
      v_sc.numero_item, v_sc.descripcion, v_sc.marca, v_sc.modelo, v_sc.cantidad, v_sc.unidad
    )
    returning id into v_nuevo_id;

    return next v_nuevo_id;
  end loop;
  return;
end;
$$;

grant execute on function public.avanzar_sc_a_rq(uuid[]) to authenticated;

create or replace function public.avanzar_rq_a_oc(p_item_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_rq record;
  v_nuevo_id uuid;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'consultor') then
    raise exception 'No autorizado';
  end if;

  foreach v_id in array p_item_ids loop
    update public.requisiciones
       set avanzo_a_oc = true, updated_at = now()
     where id = v_id and avanzo_a_oc = false
    returning * into v_rq;

    if v_rq.id is null then
      continue;
    end if;

    insert into public.ordenes_compra (
      requisicion_id, contrato_id, rq_numero, fecha_rq, codigo_defontana,
      codigo_sc, solicitado_por, numero_item, descripcion, marca, modelo, cantidad, unidad
    ) values (
      v_rq.id, v_rq.contrato_id, v_rq.rq_numero, v_rq.fecha_rq, v_rq.codigo_defontana,
      v_rq.codigo_sc, v_rq.solicitado_por, v_rq.numero_item, v_rq.descripcion, v_rq.marca,
      v_rq.modelo, v_rq.cantidad, v_rq.unidad
    )
    returning id into v_nuevo_id;

    return next v_nuevo_id;
  end loop;
  return;
end;
$$;

grant execute on function public.avanzar_rq_a_oc(uuid[]) to authenticated;

-- ---------- Devolver a la etapa anterior (botón "← SC" / "← RQ") ----------
-- Borra la fila de la etapa siguiente (fue un paso en falso, no queda
-- registro histórico de él) y reactiva la fila de la etapa anterior.
-- Solo de a una fila, como se mostró en el mockup (no hay "devolver en
-- lote").

create or replace function public.devolver_rq_a_sc(p_requisicion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud_id uuid;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'consultor') then
    raise exception 'No autorizado';
  end if;

  select solicitud_compra_id into v_solicitud_id
  from public.requisiciones
  where id = p_requisicion_id;

  if v_solicitud_id is null then
    raise exception 'Requisición % no existe', p_requisicion_id;
  end if;

  delete from public.requisiciones where id = p_requisicion_id;

  update public.solicitudes_compra
     set avanzo_a_rq = false, updated_at = now()
   where id = v_solicitud_id;
end;
$$;

grant execute on function public.devolver_rq_a_sc(uuid) to authenticated;

create or replace function public.devolver_oc_a_rq(p_orden_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requisicion_id uuid;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'consultor') then
    raise exception 'No autorizado';
  end if;

  select requisicion_id into v_requisicion_id
  from public.ordenes_compra
  where id = p_orden_id;

  if v_requisicion_id is null then
    raise exception 'Orden de compra % no existe', p_orden_id;
  end if;

  delete from public.ordenes_compra where id = p_orden_id;

  update public.requisiciones
     set avanzo_a_oc = false, updated_at = now()
   where id = v_requisicion_id;
end;
$$;

grant execute on function public.devolver_oc_a_rq(uuid) to authenticated;

-- ---------- RLS ----------
-- Mismo criterio de acceso que el módulo (ver App.tsx): Coordinador y
-- Consultor por igual, incluyendo "Devolver" (así se mostró y se
-- aprobó en el mockup). apr/supervisor/mandante quedan totalmente
-- fuera, no solo ocultos en el menú.

alter table public.solicitudes_compra enable row level security;
alter table public.requisiciones enable row level security;
alter table public.ordenes_compra enable row level security;

drop policy if exists "compras_acceso_sc" on public.solicitudes_compra;
create policy "compras_acceso_sc" on public.solicitudes_compra
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

drop policy if exists "compras_acceso_rq" on public.requisiciones;
create policy "compras_acceso_rq" on public.requisiciones
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

drop policy if exists "compras_acceso_oc" on public.ordenes_compra;
create policy "compras_acceso_oc" on public.ordenes_compra
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));

-- ---------- Storage ----------
-- No se necesita ninguna política nueva: el bucket "documentos" ya
-- permite insert/select a cualquier usuario autenticado sin importar
-- la carpeta (fix_storage_rls.sql). Convención de carpeta para estos
-- documentos: documentos/compras/<contrato_id>/<codigo_sc>/<archivo>.
