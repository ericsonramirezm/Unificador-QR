-- =============================================================================
-- 0018 — Eliminar un movimiento de verdad (reemplaza a Anular en el menú)
-- =============================================================================
-- Sin cambios respecto del original de Bodega: usa `es_admin()`, que ya
-- apunta a `usuarios.rol_bodega` desde 0001, y no toca `bodega_documentos`
-- directamente (eso lo corrige 0019).
--
-- Las migraciones 0001–0017 ya están aplicadas: esto va aparte.
--
-- Hasta acá, "Anular" (0011) era la única forma de corregir un movimiento: inserta
-- el inverso, el original nunca se toca. El usuario pidió reemplazar esa opción
-- por un borrado real, sabiendo el costo exacto (sin rastro de que existió, de
-- quién lo borró ni por qué) y confirmándolo después de que se le explicara.
--
-- Se acota a lo que se puede hacer de forma correcta y verificable:
--   - Solo Administrador (mismo límite que ya tenía Anular).
--   - No sobre un movimiento ya anulado, ni sobre una anulación — evita deshacer
--     una cadena de dos a la vez.
--   - No sobre un movimiento con artículos que controlan serie — revertir el
--     estado de una serie exige su historial completo, que no se puede
--     reconstruir de forma segura solo con lo que hay hoy.
--
-- `anular_movimiento` NO se toca ni se borra: sigue existiendo y sigue probada,
-- solo deja de ser lo que ofrece el menú contextual de Movimientos.
-- =============================================================================

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

  -- stock_cache no se toca a mano: se reconstruye sumando el libro completo, que
  -- ya está probado, en vez de revertir a mano el efecto de cada línea borrada.
  perform recalcular_stock();
end;
$$;

revoke execute on function eliminar_movimiento(uuid) from public, anon;
grant  execute on function eliminar_movimiento(uuid) to authenticated;

comment on function eliminar_movimiento(uuid) is
  'Borra un movimiento y sus líneas de verdad — sin rastro, sin poder deshacerlo. '
  'Reemplaza a anular_movimiento en el menú de Movimientos por pedido explícito '
  'del usuario, ya sabiendo el costo. Rechaza sobre una anulación, sobre un '
  'movimiento ya anulado, o sobre uno con artículos de número de serie.';
