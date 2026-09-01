-- =============================================================================
-- 0017 — Traslados reales desde Recepción + agregar líneas a una recepción ya
-- guardada
-- =============================================================================
-- Las migraciones 0001–0016 ya están aplicadas: esto va aparte.
--
-- Hasta acá, en Recepción, Origen = "Traslado interno" solo guardaba un texto
-- libre ("Viene desde") sin relación con `bodegas` — no descontaba nada en
-- ningún lado. El tipo TRASLADO (usado hasta ahora solo desde Salidas.tsx) ya
-- descuenta el origen y acredita el destino correctamente; el pedido es que
-- Recepción use ese mismo mecanismo en vez de uno cosmético aparte.
--
-- Conflicto que esto obliga a resolver: la regla de sesión de 0012 exige que
-- quien registra esté en la bodega ORIGEN. Pero quien recibe en Recepción está
-- físicamente en el DESTINO (la bodega de proyecto), no en Bodega Renca. Se
-- resuelve distinguiendo, dentro de `_registrar_movimiento_interno`, un
-- traslado CON guía (viene de Recepción: se valida contra el destino) de un
-- traslado SIN guía (viene de Salidas: se sigue validando contra el origen,
-- sin cambios de comportamiento ahí).
--
-- Además: `agregar_lineas_recepcion` permite sumar líneas a una recepción ya
-- guardada, bajo el mismo folio de guía, sin crear un movimiento aparte — una
-- excepción deliberada y acotada a la regla de que el libro es de solo
-- inserción (nunca se tocan las líneas que ya existían; solo se agregan
-- nuevas, y queda un rastro mínimo de que se hizo).
--
-- Cambios respecto del original de Bodega: `documentos` → `bodega_documentos`,
-- `mi_rol()` → `mi_rol_bodega()`, y `perfiles` → `usuarios` (bodega elegida en
-- sesión, y las dos columnas `registrado_por`/`editado_por_nombre` de
-- `v_movimientos`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. `bodega_documentos` gana la bodega de origen real
-- ---------------------------------------------------------------------------
alter table bodega_documentos add column origen_bodega_id uuid references bodegas (id);

comment on column bodega_documentos.origen_bodega_id is
  'La bodega real de la que viene un traslado interno. `origen_nombre` se sigue '
  'llenando con su nombre para no tocar ningún lector existente (v_movimientos, '
  'exportaciones); esta columna es la que de verdad dispara el descuento.';

-- ---------------------------------------------------------------------------
-- 2. El cuerpo del `for` de _registrar_movimiento_interno pasa a ser una
--    función propia, para que `agregar_lineas_recepcion` la reuse en vez de
--    reimplementar el cálculo de saldo/series.
-- ---------------------------------------------------------------------------
create or replace function _procesar_linea_movimiento(
  p_movimiento_id uuid,
  p_tipo          tipo_movimiento,
  p_bodega        uuid,
  p_bodega_destino uuid,
  p_sala          uuid,
  p_trabajador    uuid,
  p_linea         jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_art          articulos%rowtype;
  v_cantidad     numeric(14, 3);
  v_saldo        numeric(14, 3);
  v_linea_id     uuid;
  v_series       jsonb;
  v_serie_txt    text;
  v_serie_id     uuid;
  v_serie_estado estado_serie;
  v_serie_bodega uuid;
begin
  select * into v_art from articulos where id = (p_linea ->> 'articulo_id')::uuid;
  if not found then
    raise exception 'El artículo % no existe.', p_linea ->> 'articulo_id';
  end if;
  if not v_art.activo then
    raise exception 'El artículo % (%) está inactivo.', v_art.codigo_defontana, v_art.descripcion;
  end if;

  v_cantidad := (p_linea ->> 'cantidad')::numeric(14, 3);

  if v_cantidad = 0 then
    raise exception 'La cantidad del artículo % no puede ser cero.', v_art.codigo_defontana;
  end if;
  if p_tipo <> 'AJUSTE' and v_cantidad < 0 then
    raise exception 'La cantidad del artículo % debe ser positiva; el signo lo pone el tipo de movimiento.',
      v_art.codigo_defontana;
  end if;

  if p_tipo = 'TRASLADO' then
    perform _asegurar_fila_stock(v_art.id, p_bodega);
    perform _asegurar_fila_stock(v_art.id, p_bodega_destino);
    perform 1 from stock_cache
      where articulo_id = v_art.id and bodega_id in (p_bodega, p_bodega_destino)
      order by bodega_id
      for update;
  else
    perform _asegurar_fila_stock(v_art.id, p_bodega);
    perform 1 from stock_cache
      where articulo_id = v_art.id and bodega_id = p_bodega
      for update;
  end if;

  select cantidad into v_saldo
    from stock_cache
   where articulo_id = v_art.id and bodega_id = p_bodega;

  if p_tipo in ('ENTRADA', 'DEVOLUCION') then
    update stock_cache set cantidad = cantidad + v_cantidad
     where articulo_id = v_art.id and bodega_id = p_bodega;
  elsif p_tipo = 'AJUSTE' then
    if v_saldo + v_cantidad < 0 then
      raise exception 'El ajuste dejaría el stock de % (%) en %. Saldo actual: %.',
        v_art.codigo_defontana, v_art.descripcion, v_saldo + v_cantidad, v_saldo;
    end if;
    update stock_cache set cantidad = cantidad + v_cantidad
     where articulo_id = v_art.id and bodega_id = p_bodega;
  else
    if v_saldo < v_cantidad then
      raise exception 'Stock insuficiente de % (%): hay % % y se intentan mover %.',
        v_art.codigo_defontana, v_art.descripcion, v_saldo, v_art.unidad, v_cantidad;
    end if;
    update stock_cache set cantidad = cantidad - v_cantidad
     where articulo_id = v_art.id and bodega_id = p_bodega;

    if p_tipo = 'TRASLADO' then
      update stock_cache set cantidad = cantidad + v_cantidad
       where articulo_id = v_art.id and bodega_id = p_bodega_destino;
    end if;
  end if;

  insert into movimiento_lineas (
    movimiento_id, articulo_id, cantidad, cantidad_guia, costo_unitario, observacion
  ) values (
    p_movimiento_id,
    v_art.id,
    v_cantidad,
    nullif(p_linea ->> 'cantidad_guia', '')::numeric(14, 3),
    nullif(p_linea ->> 'costo_unitario', '')::numeric(14, 2),
    nullif(trim(p_linea ->> 'observacion'), '')
  )
  returning id into v_linea_id;

  v_series := coalesce(p_linea -> 'series', '[]'::jsonb);

  if v_art.controla_serie then
    if v_cantidad <> round(v_cantidad) then
      raise exception 'El artículo % se controla por serie, así que la cantidad debe ser entera (llegó %).',
        v_art.codigo_defontana, v_cantidad;
    end if;
    if jsonb_array_length(v_series) <> abs(v_cantidad)::int then
      raise exception 'El artículo % se controla por serie: se esperaban % número(s) de serie y se recibieron %.',
        v_art.codigo_defontana, abs(v_cantidad)::int, jsonb_array_length(v_series);
    end if;

    for v_serie_txt in select upper(trim(s.valor #>> '{}')) from jsonb_array_elements(v_series) as s(valor)
    loop
      if v_serie_txt is null or v_serie_txt = '' then
        raise exception 'Hay un número de serie vacío en el artículo %.', v_art.codigo_defontana;
      end if;

      select id, estado, bodega_id into v_serie_id, v_serie_estado, v_serie_bodega
        from series
       where articulo_id = v_art.id and numero_serie = v_serie_txt;

      if p_tipo = 'ENTRADA' or (p_tipo = 'AJUSTE' and v_cantidad > 0) then
        if v_serie_id is not null then
          if p_tipo = 'AJUSTE' and v_serie_estado = 'BAJA' then
            update series
               set estado = 'EN_BODEGA', bodega_id = p_bodega, sala_id = null, trabajador_id = null
             where id = v_serie_id;
          else
            raise exception 'La serie % del artículo % ya está registrada (estado: %).',
              v_serie_txt, v_art.codigo_defontana, v_serie_estado;
          end if;
        else
          insert into series (articulo_id, numero_serie, estado, bodega_id)
          values (v_art.id, v_serie_txt, 'EN_BODEGA', p_bodega)
          returning id into v_serie_id;
        end if;

      elsif p_tipo = 'DEVOLUCION' then
        if v_serie_id is null then
          raise exception 'La serie % del artículo % no está registrada.', v_serie_txt, v_art.codigo_defontana;
        end if;
        if v_serie_estado <> 'ENTREGADO' then
          raise exception 'La serie % del artículo % no está entregada (estado: %), así que no se puede devolver.',
            v_serie_txt, v_art.codigo_defontana, v_serie_estado;
        end if;
        update series
           set estado = 'DEVUELTO', bodega_id = p_bodega, sala_id = null, trabajador_id = null
         where id = v_serie_id;

      else
        if v_serie_id is null then
          raise exception 'La serie % del artículo % no está registrada.', v_serie_txt, v_art.codigo_defontana;
        end if;
        if v_serie_estado not in ('EN_BODEGA', 'DEVUELTO') then
          raise exception 'La serie % del artículo % no está disponible (estado: %).',
            v_serie_txt, v_art.codigo_defontana, v_serie_estado;
        end if;
        if v_serie_bodega is distinct from p_bodega then
          raise exception 'La serie % del artículo % no está en esta bodega.',
            v_serie_txt, v_art.codigo_defontana;
        end if;

        if p_tipo = 'TRASLADO' then
          update series set bodega_id = p_bodega_destino where id = v_serie_id;
        elsif p_tipo = 'AJUSTE' then
          update series set estado = 'BAJA', bodega_id = null where id = v_serie_id;
        else
          update series
             set estado = 'ENTREGADO',
                 bodega_id = null,
                 sala_id = p_sala,
                 trabajador_id = p_trabajador
           where id = v_serie_id;
        end if;
      end if;

      insert into movimiento_linea_series (linea_id, serie_id) values (v_linea_id, v_serie_id);
    end loop;

  elsif jsonb_array_length(v_series) > 0 then
    raise exception 'El artículo % no se controla por serie, pero se enviaron números de serie.',
      v_art.codigo_defontana;
  end if;
end;
$$;

revoke execute on function _procesar_linea_movimiento(uuid, tipo_movimiento, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. `_registrar_movimiento_interno`: usa la función anterior y distingue
--    origen vs. destino en la regla de sesión según haya guía.
-- ---------------------------------------------------------------------------
create or replace function _registrar_movimiento_interno(p jsonb, p_anula_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol            rol_usuario;
  v_tipo           tipo_movimiento;
  v_bodega         uuid;
  v_bodega_destino uuid;
  v_usuario_bodega uuid;
  v_mov_id         uuid;
  v_folio          bigint;
  v_linea          jsonb;
  v_n_lineas       int;
  v_documento_id   uuid;
begin
  v_rol := mi_rol_bodega();
  if v_rol is null then
    raise exception 'Tu usuario no tiene acceso al módulo de Bodega. Pide a un Administrador de Bodega que te asigne un rol.';
  end if;

  v_tipo := (p ->> 'tipo')::tipo_movimiento;

  if v_tipo = 'AJUSTE' then
    if v_rol <> 'ADMIN' then
      raise exception 'Solo un Administrador puede registrar ajustes de inventario.';
    end if;
  elsif v_tipo = 'ENTREGA_EPP' then
    if v_rol not in ('ADMIN', 'BODEGUERO', 'PREVENCIONISTA') then
      raise exception 'Tu rol (%) no permite registrar entregas de EPP.', v_rol;
    end if;
  else
    if v_rol not in ('ADMIN', 'BODEGUERO') then
      raise exception 'Tu rol (%) no permite registrar movimientos de inventario.', v_rol;
    end if;
  end if;

  v_n_lineas := jsonb_array_length(coalesce(p -> 'lineas', '[]'::jsonb));
  if v_n_lineas = 0 then
    raise exception 'El movimiento no tiene líneas.';
  end if;

  v_bodega         := (p ->> 'bodega_id')::uuid;
  v_bodega_destino := nullif(p ->> 'bodega_destino_id', '')::uuid;
  v_documento_id   := nullif(p ->> 'documento_id', '')::uuid;

  -- Bodeguero y Prevencionista solo pueden registrar donde físicamente están
  -- parados. Para casi todo eso es la bodega ORIGEN (`bodega_id`) — incluido
  -- el traslado que se despacha desde Salidas, sin guía. La excepción es un
  -- TRASLADO con guía (viene de Recepción, `documento_id` no nulo): ahí quien
  -- registra está en el DESTINO, recibiendo lo que despachó otra bodega —
  -- Administrador sigue exento de ambos casos, por lo mismo de siempre (anular
  -- o ajustar en cualquier bodega).
  if v_rol in ('BODEGUERO', 'PREVENCIONISTA') then
    select bodega_actual_id into v_usuario_bodega from usuarios where id = auth.uid();
    if v_usuario_bodega is null then
      raise exception 'Todavía no elegiste una bodega. Elígela desde la barra de la app antes de registrar.';
    end if;

    if v_tipo = 'TRASLADO' and v_documento_id is not null then
      if v_bodega_destino is distinct from v_usuario_bodega then
        raise exception 'Solo puedes registrar en tu bodega elegida.';
      end if;
    else
      if v_bodega is distinct from v_usuario_bodega then
        raise exception 'Solo puedes registrar movimientos en tu bodega elegida.';
      end if;
    end if;
  end if;

  insert into movimientos (
    tipo, fecha, bodega_id, documento_id, sala_id, trabajador_id,
    bodega_destino_id, retirado_por, retirado_por_id, motivo, observacion,
    anula_movimiento_id, creado_por
  ) values (
    v_tipo,
    coalesce(nullif(p ->> 'fecha', '')::date, current_date),
    v_bodega,
    v_documento_id,
    nullif(p ->> 'sala_id', '')::uuid,
    nullif(p ->> 'trabajador_id', '')::uuid,
    v_bodega_destino,
    nullif(trim(p ->> 'retirado_por'), ''),
    nullif(p ->> 'retirado_por_id', '')::uuid,
    nullif(trim(p ->> 'motivo'), ''),
    nullif(trim(p ->> 'observacion'), ''),
    p_anula_id,
    auth.uid()
  )
  returning id, folio into v_mov_id, v_folio;

  for v_linea in
    select t.valor
      from jsonb_array_elements(p -> 'lineas') as t(valor)
     order by (t.valor ->> 'articulo_id')
  loop
    perform _procesar_linea_movimiento(
      v_mov_id, v_tipo, v_bodega, v_bodega_destino,
      nullif(p ->> 'sala_id', '')::uuid, nullif(p ->> 'trabajador_id', '')::uuid,
      v_linea
    );
  end loop;

  return jsonb_build_object('movimiento_id', v_mov_id, 'folio', v_folio);
end;
$$;

revoke execute on function _registrar_movimiento_interno(jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. `registrar_recepcion`: arma un TRASLADO en vez de un ENTRADA cuando el
--    traslado interno trae una bodega de origen real.
-- ---------------------------------------------------------------------------
create or replace function registrar_recepcion(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc                 jsonb := p -> 'documento';
  v_doc_id               uuid;
  v_origen               text;
  v_origen_bodega        uuid;
  v_origen_bodega_nombre text;
begin
  if not puede_mover() then
    raise exception 'Tu rol no permite registrar recepciones de material.';
  end if;
  if v_doc is null then
    raise exception 'Falta la guía de despacho de la recepción.';
  end if;

  v_origen        := coalesce(nullif(v_doc ->> 'origen', ''), 'TRASLADO_INTERNO');
  v_origen_bodega := nullif(v_doc ->> 'origen_bodega_id', '')::uuid;

  -- No se exige aquí a propósito: la pantalla de Recepción sí lo exige para un
  -- traslado interno nuevo, pero la función se mantiene permisiva para no
  -- romper una guía histórica o cualquier otro llamador que todavía use el
  -- texto libre de `origen_nombre` sin una bodega rastreada.

  if v_origen_bodega is not null then
    select nombre into v_origen_bodega_nombre from bodegas where id = v_origen_bodega and activo;
    if not found then
      raise exception 'Esa bodega de origen no existe o no está activa.';
    end if;
  end if;

  insert into bodega_documentos (
    tipo, folio, fecha, origen, origen_nombre, origen_bodega_id, proveedor_id, orden_compra, creado_por
  )
  values (
    coalesce(nullif(v_doc ->> 'tipo', ''), 'GUIA_DESPACHO')::tipo_documento,
    trim(v_doc ->> 'folio'),
    coalesce(nullif(v_doc ->> 'fecha', '')::date, current_date),
    v_origen::origen_documento,
    coalesce(v_origen_bodega_nombre, nullif(trim(v_doc ->> 'origen_nombre'), '')),
    v_origen_bodega,
    nullif(v_doc ->> 'proveedor_id', '')::uuid,
    nullif(trim(v_doc ->> 'orden_compra'), ''),
    auth.uid()
  )
  returning id into v_doc_id;

  if v_origen_bodega is not null then
    -- Traslado real: la bodega elegida despacha (origen), la bodega de sesión
    -- recibe (destino) — mismo tipo TRASLADO que ya usa Salidas.tsx, solo que
    -- éste sí lleva documento_id, que es lo que activa la validación por
    -- destino en el paso 3.
    return registrar_movimiento(
      (p - 'documento') || jsonb_build_object(
        'documento_id', v_doc_id,
        'tipo', 'TRASLADO',
        'bodega_destino_id', p ->> 'bodega_id',
        'bodega_id', v_origen_bodega::text
      )
    );
  end if;

  -- Compra externa (o, en el futuro, un traslado interno sin bodega
  -- rastreada): una recepción sigue siendo un ENTRADA, como siempre.
  return registrar_movimiento(
    (p - 'documento') || jsonb_build_object('documento_id', v_doc_id, 'tipo', 'ENTRADA')
  );
end;
$$;

revoke execute on function registrar_recepcion(jsonb) from public, anon;
grant  execute on function registrar_recepcion(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Rastro mínimo de que a un movimiento se le agregó algo después de creado
-- ---------------------------------------------------------------------------
alter table movimientos add column editado_en timestamptz;
alter table movimientos add column editado_por uuid references auth.users (id);

comment on column movimientos.editado_en is
  'Cuándo se le agregaron líneas nuevas después de creado, vía '
  'agregar_lineas_recepcion. Las líneas que ya existían nunca se tocan; esto '
  'es lo único que distingue un movimiento así de uno que nunca se volvió a '
  'abrir. Null si nunca se le agregó nada.';

-- ---------------------------------------------------------------------------
-- 6. Agregar líneas a una recepción ya guardada, sin crear un movimiento
--    nuevo — excepción acotada a la regla de que el libro es de solo
--    inserción: se agrega, nunca se edita ni se borra una línea existente.
-- ---------------------------------------------------------------------------
create or replace function agregar_lineas_recepcion(p_movimiento_id uuid, p_lineas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol            rol_usuario;
  v_mov            movimientos%rowtype;
  v_usuario_bodega uuid;
  v_linea          jsonb;
  v_n_lineas       int;
begin
  v_rol := mi_rol_bodega();
  if v_rol is null then
    raise exception 'Tu usuario no tiene acceso al módulo de Bodega.';
  end if;
  if v_rol not in ('ADMIN', 'BODEGUERO') then
    raise exception 'Tu rol (%) no permite agregar líneas a una recepción.', v_rol;
  end if;

  v_n_lineas := jsonb_array_length(coalesce(p_lineas, '[]'::jsonb));
  if v_n_lineas = 0 then
    raise exception 'No hay ninguna línea que agregar.';
  end if;

  select * into v_mov from movimientos where id = p_movimiento_id;
  if not found then
    raise exception 'Ese movimiento no existe.';
  end if;
  if v_mov.tipo not in ('ENTRADA', 'TRASLADO') or v_mov.documento_id is null then
    raise exception 'Solo se pueden agregar líneas a una recepción con guía (entrada o traslado interno).';
  end if;
  if v_mov.anula_movimiento_id is not null then
    raise exception 'Ese movimiento es una anulación; no se le pueden agregar líneas.';
  end if;
  if exists (select 1 from movimientos where anula_movimiento_id = p_movimiento_id) then
    raise exception 'Esta recepción ya fue anulada; no se le pueden agregar líneas.';
  end if;

  if v_rol = 'BODEGUERO' then
    select bodega_actual_id into v_usuario_bodega from usuarios where id = auth.uid();
    if v_usuario_bodega is null then
      raise exception 'Todavía no elegiste una bodega. Elígela desde la barra de la app antes de registrar.';
    end if;
    if v_mov.tipo = 'TRASLADO' then
      if v_usuario_bodega is distinct from v_mov.bodega_destino_id then
        raise exception 'Solo puedes agregar líneas a una recepción de tu bodega elegida.';
      end if;
    else
      if v_usuario_bodega is distinct from v_mov.bodega_id then
        raise exception 'Solo puedes agregar líneas a una recepción de tu bodega elegida.';
      end if;
    end if;
  end if;

  for v_linea in select t.valor from jsonb_array_elements(p_lineas) as t(valor) order by (t.valor ->> 'articulo_id')
  loop
    perform _procesar_linea_movimiento(
      p_movimiento_id, v_mov.tipo, v_mov.bodega_id, v_mov.bodega_destino_id,
      null::uuid, null::uuid,
      v_linea
    );
  end loop;

  update movimientos set editado_en = now(), editado_por = auth.uid() where id = p_movimiento_id;

  return jsonb_build_object('movimiento_id', p_movimiento_id, 'folio', v_mov.folio);
end;
$$;

revoke execute on function agregar_lineas_recepcion(uuid, jsonb) from public, anon;
grant  execute on function agregar_lineas_recepcion(uuid, jsonb) to authenticated;

comment on function agregar_lineas_recepcion(uuid, jsonb) is
  'Suma líneas nuevas a una recepción (ENTRADA o TRASLADO con guía) ya '
  'guardada, bajo el mismo folio — nunca toca las líneas que ya existían. '
  'Excepción acotada y deliberada a que el libro es de solo inserción: sigue '
  'siendo solo inserción de líneas, nunca UPDATE ni DELETE de una ya escrita.';

-- ---------------------------------------------------------------------------
-- 7. `v_movimientos` expone lo nuevo — columnas al final, mismo `create or
--    replace view` de siempre.
-- ---------------------------------------------------------------------------
create or replace view v_movimientos with (security_invoker = true) as
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
         exists (select 1
                   from movimiento_lineas l
                  where l.movimiento_id = m.id
                    and l.cantidad_guia is not null
                    and l.cantidad_guia <> l.cantidad) as tiene_diferencia,
         d.origen,
         d.origen_nombre,
         m.retirado_por_id,
         rt.nombre  as retirado_por_nombre,
         (select o.folio from movimientos o where o.id = m.anula_movimiento_id) as anula_folio,
         (select r.id    from movimientos r where r.anula_movimiento_id = m.id) as anulado_por_id,
         (select r.folio from movimientos r where r.anula_movimiento_id = m.id) as anulado_por_folio,
         -- Columnas nuevas de esta migración, al final.
         d.origen_bodega_id,
         m.editado_en,
         m.editado_por,
         ed.nombre  as editado_por_nombre
    from movimientos m
    join bodegas b            on b.id  = m.bodega_id
    left join bodegas bd      on bd.id = m.bodega_destino_id
    left join salas_electricas s on s.id = m.sala_id
    left join trabajadores t  on t.id  = m.trabajador_id
    left join trabajadores rt on rt.id = m.retirado_por_id
    left join bodega_documentos d on d.id  = m.documento_id
    left join proveedores pv  on pv.id = d.proveedor_id
    left join usuarios pf     on pf.id = m.creado_por
    left join usuarios ed     on ed.id = m.editado_por;

grant select on v_movimientos to authenticated;
revoke all   on v_movimientos from anon;
