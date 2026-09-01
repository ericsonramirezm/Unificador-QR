-- =============================================================================
-- 0008 — Lo que el origen quedó debiendo
-- =============================================================================
-- Cuando llega menos de lo que declara la guía, la diferencia ya queda registrada
-- en la línea del movimiento (`cantidad` < `cantidad_guia`). Lo que faltaba era
-- poder perseguirla: saber qué está pendiente y darla por cerrada.
--
-- **El pendiente NO se guarda: se deriva del libro.** Crear una tabla de
-- pendientes sería una segunda verdad capaz de contradecir al libro — justo lo
-- que este diseño evita en todo lo demás. Lo único que se almacena es la
-- RESOLUCIÓN, que es un hecho nuevo y no está en el libro.
--
-- Es material, no dinero: lo normal es un traslado interno entre bodegas de
-- WILUG, donde no hay nada que facturar. El origen debe unidades.
-- =============================================================================

create type motivo_resolucion as enum (
  'LLEGO_DESPUES',   -- el material llegó en un despacho posterior
  'MERMA_ACEPTADA',  -- se da por perdido y no se reclama
  'ERROR_GUIA'       -- la guía estaba mal; nunca faltó nada
);

create table resoluciones_pendiente (
  linea_id    uuid primary key references movimiento_lineas (id) on delete cascade,
  motivo      motivo_resolucion not null,
  nota        text,
  resuelto_por uuid not null references auth.users (id),
  resuelto_en timestamptz not null default now()
);

comment on table resoluciones_pendiente is
  'Cierre de un faltante. Una fila por línea resuelta; su ausencia significa que '
  'el pendiente sigue abierto. El movimiento original nunca se modifica.';

alter table resoluciones_pendiente enable row level security;

-- `mi_rol_bodega() is not null`, no `using (true)`: ver el ajuste de
-- seguridad documentado en el encabezado de 0002 — "authenticated" en
-- Unificador-QR incluye a cualquier usuario del resto de la app, no solo a
-- quienes tienen rol de Bodega.
create policy leer_resoluciones on resoluciones_pendiente
  for select to authenticated using (mi_rol_bodega() is not null);

-- Cierra quien recibe, que es quien se entera de si el material llegó.
create policy resolver_pendientes on resoluciones_pendiente
  for insert to authenticated
  with check (puede_mover() and resuelto_por = auth.uid());

-- Corregir un cierre mal puesto sí es cosa del Administrador: dar algo por
-- perdido y que después aparezca no debería poder reescribirlo cualquiera.
create policy corregir_resoluciones on resoluciones_pendiente
  for all to authenticated
  using (es_admin()) with check (es_admin());

-- ---------------------------------------------------------------------------
-- La vista: faltantes derivados del libro + su resolución si la tienen
-- ---------------------------------------------------------------------------
create view v_pendientes with (security_invoker = true) as
  select l.id                                   as linea_id,
         m.id                                   as movimiento_id,
         m.folio                                as movimiento_folio,
         m.fecha,
         d.folio                                as guia_folio,
         d.origen,
         d.origen_nombre,
         pv.nombre                              as proveedor,
         a.id                                   as articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.unidad,
         l.cantidad_guia,
         l.cantidad                             as cantidad_recibida,
         (l.cantidad_guia - l.cantidad)         as cantidad_faltante,
         (current_date - m.fecha)               as dias_abierto,
         r.motivo,
         r.nota,
         r.resuelto_en,
         pf.nombre                              as resuelto_por_nombre,
         (r.linea_id is null)                   as pendiente
    from movimiento_lineas l
    join movimientos m  on m.id = l.movimiento_id
    join articulos a    on a.id = l.articulo_id
    left join bodega_documentos d on d.id = m.documento_id
    left join proveedores pv on pv.id = d.proveedor_id
    left join resoluciones_pendiente r on r.linea_id = l.id
    left join usuarios pf on pf.id = r.resuelto_por
   -- Solo los faltantes: si llegó de más no hay nada que cobrarle a nadie, y la
   -- diferencia sigue visible en el movimiento.
   where l.cantidad_guia is not null
     and l.cantidad < l.cantidad_guia;

grant select on v_pendientes to authenticated;
revoke all on v_pendientes from anon;
