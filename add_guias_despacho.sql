-- ============================================================
-- Módulo "Compras" — cuarta etapa: Guías de Despacho (GD), después de
-- Órdenes de Compra (OC). Mismo patrón que add_compras.sql: cada ítem
-- que avanza genera una fila NUEVA en guias_despacho, copiando los
-- datos heredados; la fila de ordenes_compra NO se borra, solo se
-- oculta del listado (avanzo_a_gd = true) para conservar la
-- trazabilidad completa SC -> RQ -> OC -> GD.
--
-- Por ahora Guías de Despacho no tiene una quinta etapa definida
-- (avanzar_gd_a_algo queda para cuando se defina), pero SÍ queda con
-- su propio N° (guia_numero) para poder agrupar/filtrar, igual que
-- rq_numero y oc_numero en las etapas anteriores.
-- ============================================================

-- ---------- Órdenes de Compra: marca de avance ----------
alter table public.ordenes_compra add column if not exists avanzo_a_gd boolean not null default false;

create index if not exists idx_ordenes_compra_avanzo_gd
  on public.ordenes_compra (contrato_id, avanzo_a_gd, created_at desc);

-- ---------- Guías de Despacho (GD) ----------
-- Orden de columnas: igual que las demás pestañas (Solicitado por | N° |
-- Código Defontana | Descripción | Marca | Modelo | Cantidad | Unidad |
-- Solicitud de Compra | Fecha de Solicitud | Documento | RQ | Fecha RQ |
-- Proveedor | OC | Fecha OC), agregando al final los campos propios de
-- esta etapa: Guía N°, Fecha de Guía y Cantidad Recibida.
create table if not exists public.guias_despacho (
  id uuid primary key default gen_random_uuid(),

  -- Origen, para trazabilidad y para que "Devolver" sepa a qué fila de
  -- OC hay que reactivar.
  orden_compra_id uuid not null references public.ordenes_compra(id),
  contrato_id uuid not null references public.contratos(id),

  -- Heredado de OC (que a su vez lo heredó de RQ y de SC) al momento de
  -- avanzar. Snapshot: no se vuelve a leer de ordenes_compra después.
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
  oc_numero text,
  proveedor text,
  fecha_oc date,

  -- Propios de GD: llegan en blanco ("por llenar" en la UI) y se
  -- completan a mano en la pestaña Guías de Despacho.
  guia_numero text,
  fecha_guia date,
  cantidad_recibida numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (orden_compra_id)
);

create index if not exists idx_guias_despacho_contrato
  on public.guias_despacho (contrato_id, created_at desc);
-- Buscador propio de GD: coincidencia exacta por su propio N° de Guía.
create index if not exists idx_guias_despacho_guia_numero
  on public.guias_despacho (guia_numero);

-- ---------- Avanzar de etapa (botón "Pasar a Guías de Despacho →") ----------
-- Mismo patrón que avanzar_rq_a_oc: recibe un arreglo de ids (fila sola
-- o selección en lote), marca avanzo_a_gd = true en el origen SOLO si
-- todavía no había avanzado, inserta la fila nueva con los campos
-- propios de GD en blanco. Todo en una sola función = una sola
-- transacción.

create or replace function public.avanzar_oc_a_gd(p_item_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_oc record;
  v_nuevo_id uuid;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'consultor') then
    raise exception 'No autorizado';
  end if;

  foreach v_id in array p_item_ids loop
    update public.ordenes_compra
       set avanzo_a_gd = true, updated_at = now()
     where id = v_id and avanzo_a_gd = false
    returning * into v_oc;

    if v_oc.id is null then
      continue; -- ya estaba avanzado (o no existe): se ignora, no se duplica
    end if;

    insert into public.guias_despacho (
      orden_compra_id, contrato_id, rq_numero, fecha_rq, codigo_defontana,
      codigo_sc, solicitado_por, numero_item, descripcion, marca, modelo,
      cantidad, unidad, oc_numero, proveedor, fecha_oc
    ) values (
      v_oc.id, v_oc.contrato_id, v_oc.rq_numero, v_oc.fecha_rq, v_oc.codigo_defontana,
      v_oc.codigo_sc, v_oc.solicitado_por, v_oc.numero_item, v_oc.descripcion, v_oc.marca,
      v_oc.modelo, v_oc.cantidad, v_oc.unidad, v_oc.oc_numero, v_oc.proveedor, v_oc.fecha_oc
    )
    returning id into v_nuevo_id;

    return next v_nuevo_id;
  end loop;
  return;
end;
$$;

grant execute on function public.avanzar_oc_a_gd(uuid[]) to authenticated;

-- ---------- Devolver a la etapa anterior (botón "← OC") ----------
-- Mismo patrón que devolver_oc_a_rq: borra la fila de GD (fue un paso
-- en falso, no queda registro histórico de él) y reactiva la fila de
-- OC. Solo de a una fila.

create or replace function public.devolver_gd_a_oc(p_guia_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden_id uuid;
begin
  if public.usuario_rol_actual() not in ('coordinador', 'consultor') then
    raise exception 'No autorizado';
  end if;

  select orden_compra_id into v_orden_id
  from public.guias_despacho
  where id = p_guia_id;

  if v_orden_id is null then
    raise exception 'Guía de despacho % no existe', p_guia_id;
  end if;

  delete from public.guias_despacho where id = p_guia_id;

  update public.ordenes_compra
     set avanzo_a_gd = false, updated_at = now()
   where id = v_orden_id;
end;
$$;

grant execute on function public.devolver_gd_a_oc(uuid) to authenticated;

-- ---------- RLS ----------
-- Mismo criterio que las demás tablas de Compras: Coordinador y
-- Consultor por igual, incluyendo "Devolver" y "Eliminar" ("for all"
-- cubre select/insert/update/delete). apr/supervisor/mandante quedan
-- totalmente fuera.

alter table public.guias_despacho enable row level security;

drop policy if exists "compras_acceso_gd" on public.guias_despacho;
create policy "compras_acceso_gd" on public.guias_despacho
  for all using (public.usuario_rol_actual() in ('coordinador', 'consultor'))
  with check (public.usuario_rol_actual() in ('coordinador', 'consultor'));
