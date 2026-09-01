-- =============================================================================
-- 0019 — Correcciones a la eliminación real de movimientos (0018)
-- =============================================================================
-- Las migraciones 0001–0018 ya están aplicadas: esto va aparte.
--
-- Al usar `eliminar_movimiento` en la práctica aparecieron dos problemas:
--
-- 1. `eliminar_movimiento` borraba el movimiento y sus líneas, pero no la guía
--    de despacho (`bodega_documentos`) que quedaba huérfana. Como
--    `bodega_documentos_folio_uq` es único por (tipo, proveedor, folio), volver
--    a recibir la misma guía después de eliminar el movimiento chocaba con el
--    registro huérfano y fallaba — el usuario no podía corregir su propio
--    error. Ahora, al eliminar, si el documento asociado queda sin ningún otro
--    movimiento que lo use, se borra también.
--
-- 2. `equivalencias_proveedor.articulo_id` no tenía `on delete cascade`.
--    Cualquier artículo al que se le hubiera enseñado un código de proveedor
--    quedaba imposible de eliminar (23503), incluso después de borrar todos
--    sus movimientos, porque esa fila de equivalencia lo seguía referenciando.
--    Esa tabla es solo una ayuda de búsqueda ("no participa del libro de
--    movimientos ni del traslado", 0013) — sin el artículo, no tiene sentido
--    que siga existiendo, así que ahora se borra con él.
--
-- Único cambio respecto del original de Bodega: `documentos` → `bodega_documentos`.
-- =============================================================================

alter table equivalencias_proveedor
  drop constraint equivalencias_proveedor_articulo_id_fkey,
  add constraint equivalencias_proveedor_articulo_id_fkey
    foreign key (articulo_id) references articulos (id) on delete cascade;

create or replace function eliminar_movimiento(p_movimiento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov movimientos%rowtype;
begin
  if not es_admin() then
    raise exception 'Solo un Administrador puede eliminar un movimiento.';
  end if;

  select * into v_mov from movimientos where id = p_movimiento_id;
  if not found then
    raise exception 'Ese movimiento no existe.';
  end if;

  if v_mov.anula_movimiento_id is not null then
    raise exception 'Esto es una anulación; no se puede eliminar por separado del movimiento que anula.';
  end if;
  if exists (select 1 from movimientos where anula_movimiento_id = p_movimiento_id) then
    raise exception 'Este movimiento ya fue anulado; elimina la anulación primero si de verdad quieres borrar los dos.';
  end if;
  if exists (
    select 1
      from movimiento_lineas l
      join articulos a on a.id = l.articulo_id
     where l.movimiento_id = p_movimiento_id and a.controla_serie
  ) then
    raise exception 'No se puede eliminar un movimiento con artículos de número de serie; anúlalo en su lugar.';
  end if;

  -- movimiento_linea_series y resoluciones_pendiente se van solos: ambos tienen
  -- "on delete cascade" contra movimiento_lineas.id (0001_esquema.sql y
  -- 0008_pendientes.sql).
  delete from movimiento_lineas where movimiento_id = p_movimiento_id;
  delete from movimientos where id = p_movimiento_id;

  -- La guía de despacho no es parte del libro: es la cabecera que el movimiento
  -- colgaba. Si este era el único movimiento que la usaba, queda huérfana y
  -- bloquea sin necesidad volver a recibir el mismo folio; se borra con él.
  if v_mov.documento_id is not null
     and not exists (select 1 from movimientos where documento_id = v_mov.documento_id)
  then
    delete from bodega_documentos where id = v_mov.documento_id;
  end if;

  -- stock_cache no se toca a mano: se reconstruye sumando el libro completo, que
  -- ya está probado, en vez de revertir a mano el efecto de cada línea borrada.
  perform recalcular_stock();
end;
$$;

revoke execute on function eliminar_movimiento(uuid) from public, anon;
grant  execute on function eliminar_movimiento(uuid) to authenticated;

comment on function eliminar_movimiento(uuid) is
  'Borra un movimiento y sus líneas de verdad — sin rastro, sin poder deshacerlo. '
  'También borra su guía de despacho si queda huérfana. Reemplaza a '
  'anular_movimiento en el menú de Movimientos por pedido explícito del '
  'usuario, ya sabiendo el costo. Rechaza sobre una anulación, sobre un '
  'movimiento ya anulado, o sobre uno con artículos de número de serie.';
