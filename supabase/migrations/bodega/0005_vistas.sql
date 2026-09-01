-- =============================================================================
-- 0005 — Vistas de consulta para las pantallas
-- =============================================================================
-- Todas con `security_invoker = true`: la vista se evalúa con los permisos de
-- quien consulta, no con los del dueño. Sin esto, una vista creada por `postgres`
-- se salta la RLS de las tablas que lee.
--
-- Cambios respecto del original: `documentos` → `bodega_documentos` (0001), y
-- `perfiles pf` → `usuarios pf` para resolver `registrado_por` (0001: no hay
-- tabla `perfiles`, el nombre de quien registró sale de `usuarios.nombre`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Línea de tiempo de Movimientos: una fila por movimiento, ya desnormalizada,
-- para que la pantalla principal no tenga que encadenar ocho joins en el cliente.
-- ---------------------------------------------------------------------------
create view v_movimientos with (security_invoker = true) as
  select m.id,
         m.folio,
         m.tipo,
         m.fecha,
         m.creado_en,
         m.bodega_id,
         b.nombre   as bodega,
         m.bodega_destino_id,
         bd.nombre  as bodega_destino,
         m.sala_id,
         s.nombre   as sala,
         m.trabajador_id,
         t.nombre   as trabajador,
         t.rut      as trabajador_rut,
         m.documento_id,
         d.tipo     as documento_tipo,
         d.folio    as documento_folio,
         d.fecha    as documento_fecha,
         d.orden_compra,
         d.archivo_path,
         d.proveedor_id,
         pv.nombre  as proveedor,
         m.retirado_por,
         m.motivo,
         m.observacion,
         m.anula_movimiento_id,
         m.creado_por,
         pf.nombre  as registrado_por,
         (select count(*)
            from movimiento_lineas l
           where l.movimiento_id = m.id) as n_lineas,
         (select coalesce(sum(abs(l.cantidad)), 0)
            from movimiento_lineas l
           where l.movimiento_id = m.id) as total_unidades,
         -- Recepción donde lo recibido no calza con lo que declara la guía.
         exists (select 1
                   from movimiento_lineas l
                  where l.movimiento_id = m.id
                    and l.cantidad_guia is not null
                    and l.cantidad_guia <> l.cantidad) as tiene_diferencia
    from movimientos m
    join bodegas b            on b.id  = m.bodega_id
    left join bodegas bd      on bd.id = m.bodega_destino_id
    left join salas_electricas s on s.id = m.sala_id
    left join trabajadores t  on t.id  = m.trabajador_id
    left join bodega_documentos d on d.id  = m.documento_id
    left join proveedores pv  on pv.id = d.proveedor_id
    left join usuarios pf     on pf.id = m.creado_por;

-- ---------------------------------------------------------------------------
-- Detalle de líneas, con el artículo resuelto y las series que movió cada una.
-- ---------------------------------------------------------------------------
create view v_movimiento_lineas with (security_invoker = true) as
  select l.id,
         l.movimiento_id,
         m.tipo   as movimiento_tipo,
         m.fecha,
         l.articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.tipo   as articulo_tipo,
         a.unidad,
         a.marca,
         l.cantidad,
         l.cantidad_guia,
         case when l.cantidad_guia is null then null
              else l.cantidad - l.cantidad_guia end as diferencia,
         l.costo_unitario,
         l.observacion,
         coalesce(
           (select array_agg(se.numero_serie order by se.numero_serie)
              from movimiento_linea_series mls
              join series se on se.id = mls.serie_id
             where mls.linea_id = l.id),
           '{}'::text[]
         ) as series
    from movimiento_lineas l
    join movimientos m on m.id = l.movimiento_id
    join articulos a   on a.id = l.articulo_id;

-- ---------------------------------------------------------------------------
-- Ficha de serie: dónde está cada unidad serializada ahora mismo.
-- Responde "¿dónde quedó el panel serie 4471?".
-- ---------------------------------------------------------------------------
create view v_series with (security_invoker = true) as
  select se.id,
         se.numero_serie,
         se.estado,
         se.articulo_id,
         a.codigo_defontana,
         a.descripcion,
         se.bodega_id,
         b.nombre  as bodega,
         se.sala_id,
         s.nombre  as sala,
         se.trabajador_id,
         t.nombre  as trabajador,
         se.creado_en,
         case se.estado
           when 'EN_BODEGA' then b.nombre
           when 'DEVUELTO'  then b.nombre
           when 'ENTREGADO' then coalesce(s.nombre, t.nombre)
           when 'BAJA'      then 'Dada de baja'
         end as ubicacion_actual
    from series se
    join articulos a          on a.id = se.articulo_id
    left join bodegas b       on b.id = se.bodega_id
    left join salas_electricas s on s.id = se.sala_id
    left join trabajadores t  on t.id = se.trabajador_id;

-- ---------------------------------------------------------------------------
-- Historial de EPP por trabajador. Es todo lo que el usuario pidió del módulo de
-- EPP: sin acta en PDF, sin firma y sin vencimientos (decisión confirmada).
-- ---------------------------------------------------------------------------
create view v_epp_por_trabajador with (security_invoker = true) as
  select t.id     as trabajador_id,
         t.rut,
         t.nombre as trabajador,
         t.cargo,
         a.id     as articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.unidad,
         sum(case when m.tipo = 'ENTREGA_EPP' then l.cantidad else -l.cantidad end) as cantidad_vigente,
         sum(case when m.tipo = 'ENTREGA_EPP' then l.cantidad else 0 end)           as total_entregado,
         max(m.fecha) as ultima_fecha
    from movimiento_lineas l
    join movimientos m   on m.id = l.movimiento_id
    join trabajadores t  on t.id = m.trabajador_id
    join articulos a     on a.id = l.articulo_id
   where m.tipo in ('ENTREGA_EPP', 'DEVOLUCION')
     and m.trabajador_id is not null
   group by t.id, t.rut, t.nombre, t.cargo, a.id, a.codigo_defontana, a.descripcion, a.unidad;

-- ---------------------------------------------------------------------------
-- Consumo por sala eléctrica: qué se instaló en cada recinto.
-- ---------------------------------------------------------------------------
create view v_consumo_por_sala with (security_invoker = true) as
  select s.id     as sala_id,
         s.nombre as sala,
         a.id     as articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.unidad,
         sum(case when m.tipo = 'SALIDA_SALA' then l.cantidad else -l.cantidad end) as cantidad_neta,
         max(m.fecha) as ultima_fecha
    from movimiento_lineas l
    join movimientos m      on m.id = l.movimiento_id
    join salas_electricas s on s.id = m.sala_id
    join articulos a        on a.id = l.articulo_id
   where m.tipo in ('SALIDA_SALA', 'DEVOLUCION')
     and m.sala_id is not null
   group by s.id, s.nombre, a.id, a.codigo_defontana, a.descripcion, a.unidad;

-- ---------------------------------------------------------------------------
-- Grants: el rol anónimo no ve nada. Todo pasa por un usuario autenticado.
-- ---------------------------------------------------------------------------
grant select on v_movimientos, v_movimiento_lineas, v_series,
                v_epp_por_trabajador, v_consumo_por_sala,
                v_stock, v_stock_libro, v_series_disponibles
  to authenticated;

revoke all on v_movimientos, v_movimiento_lineas, v_series,
              v_epp_por_trabajador, v_consumo_por_sala,
              v_stock, v_stock_libro, v_series_disponibles, v_movimiento_efectos
  from anon;
