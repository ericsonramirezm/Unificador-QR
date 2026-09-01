-- =============================================================================
-- 0006 — De dónde viene lo que entra a bodega
-- =============================================================================
-- Las migraciones 0001–0005 YA ESTÁN APLICADAS en producción (en el proyecto
-- original de Bodega; este set adaptado las lleva íntegras al de
-- Unificador-QR), así que no se editan: todo cambio de esquema va en un
-- archivo nuevo como este.
--
-- Motivo del cambio: al revisar las guías de despacho reales del contrato
-- (GD 26423, 26426, 26562, 26574, 26577) resultó que **ninguna es una compra a un
-- proveedor externo**. Las cinco las emite WILUG a WILUG — mismo RUT en emisor y
-- receptor, "Tipo Traslado: Otros traslados (no venta)" o "Traslados internos",
-- total $0 — y son despachos desde la bodega central de Coquimbo a la faena. La
-- carpeta "Guías de despacho proveedor" del proyecto está vacía.
--
-- El modelo original asumía compra con proveedor y orden de compra. Eso pasa a
-- ser el caso excepcional, no el normal.
-- =============================================================================

create type origen_documento as enum (
  'TRASLADO_INTERNO', -- despacho desde la bodega central de WILUG (el caso normal)
  'COMPRA_EXTERNA'    -- compra a un proveedor de verdad
);

alter table bodega_documentos
  add column origen origen_documento not null default 'TRASLADO_INTERNO',
  add column origen_nombre text;

comment on column bodega_documentos.origen_nombre is
  'De dónde viene físicamente: "Bodega Central Coquimbo" en un traslado interno. '
  'En una compra externa el origen lo identifica `proveedor_id`.';

-- Un traslado interno no tiene proveedor, y una compra externa sí. Exigir lo que
-- corresponde a cada uno evita recepciones a medio identificar.
alter table bodega_documentos
  add constraint documento_origen_coherente check (
    case origen
      when 'COMPRA_EXTERNA'   then proveedor_id is not null
      when 'TRASLADO_INTERNO' then true
    end
  );

-- ---------------------------------------------------------------------------
-- El hueco que destapó el cambio
-- ---------------------------------------------------------------------------
-- `bodega_documentos_folio_uq` era un índice PARCIAL: solo aplicaba `where
-- proveedor_id is not null`. Con el modelo viejo daba igual, porque toda guía
-- traía proveedor. Con traslados internos —que no lo tienen— la unicidad
-- simplemente no se aplicaba: se podía recibir dos veces la misma guía e
-- inflar el stock sin que nada avisara. Es justo el error que el índice
-- existía para impedir.
drop index if exists bodega_documentos_folio_uq;

create unique index bodega_documentos_folio_uq
  on bodega_documentos (tipo, folio, coalesce(proveedor_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- Recibir una guía es UNA operación, no dos
-- ---------------------------------------------------------------------------
-- Si el frontend creara primero el documento y después llamara a
-- `registrar_movimiento`, un fallo en el segundo paso (una serie ya registrada,
-- por ejemplo) dejaría la guía huérfana en la base. Al reintentar, el índice de
-- folio la rechazaría con "esa guía ya fue recibida" — siendo que no se recibió
-- nada. Este envoltorio mete las dos escrituras en la misma transacción: si algo
-- falla, no queda rastro y el reintento funciona.
create or replace function registrar_recepcion(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc jsonb := p -> 'documento';
  v_doc_id uuid;
begin
  if not puede_mover() then
    raise exception 'Tu rol no permite registrar recepciones de material.';
  end if;
  if v_doc is null then
    raise exception 'Falta la guía de despacho de la recepción.';
  end if;

  insert into bodega_documentos (tipo, folio, fecha, origen, origen_nombre, proveedor_id, orden_compra, creado_por)
  values (
    coalesce(nullif(v_doc ->> 'tipo', ''), 'GUIA_DESPACHO')::tipo_documento,
    trim(v_doc ->> 'folio'),
    coalesce(nullif(v_doc ->> 'fecha', '')::date, current_date),
    coalesce(nullif(v_doc ->> 'origen', ''), 'TRASLADO_INTERNO')::origen_documento,
    nullif(trim(v_doc ->> 'origen_nombre'), ''),
    nullif(v_doc ->> 'proveedor_id', '')::uuid,
    nullif(trim(v_doc ->> 'orden_compra'), ''),
    auth.uid()
  )
  returning id into v_doc_id;

  -- El tipo se fija aquí: una recepción siempre es una ENTRADA.
  return registrar_movimiento(
    (p - 'documento') || jsonb_build_object('documento_id', v_doc_id, 'tipo', 'ENTRADA')
  );
end;
$$;

revoke execute on function registrar_recepcion(jsonb) from public, anon;
grant  execute on function registrar_recepcion(jsonb) to authenticated;

comment on function registrar_recepcion(jsonb) is
  'Crea la guía de despacho y su movimiento de ENTRADA en una sola transacción. '
  'Recibe {documento:{folio,fecha,origen,origen_nombre,proveedor_id,orden_compra}, '
  'bodega_id, observacion, lineas:[...]} y devuelve {movimiento_id, folio}.';
