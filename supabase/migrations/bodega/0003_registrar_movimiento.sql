-- =============================================================================
-- 0003 — `registrar_movimiento`: la única puerta de escritura del libro
-- =============================================================================
-- Todo movimiento entra por aquí. La función corre en una sola transacción y:
--   1. verifica el rol de quien llama,
--   2. bloquea la fila de saldo del artículo (serializa dos descuentos simultáneos),
--   3. rechaza dejar el stock negativo,
--   4. valida las series una por una,
--   5. inserta cabecera + líneas y actualiza la caché de saldo.
--
-- Si algo falla, no queda nada a medias: la transacción entera se revierte.
--
-- Único cambio respecto del original de Bodega: `mi_rol()` → `mi_rol_bodega()`
-- (0001), que lee `usuarios.rol_bodega` en vez de `perfiles.rol`.
-- =============================================================================

-- Crea la fila de saldo si aún no existe, para poder bloquearla.
create or replace function _asegurar_fila_stock(p_articulo uuid, p_bodega uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into stock_cache (articulo_id, bodega_id, cantidad)
  values (p_articulo, p_bodega, 0)
  on conflict (articulo_id, bodega_id) do nothing;
end;
$$;

create or replace function registrar_movimiento(p jsonb)
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
  v_mov_id         uuid;
  v_folio          bigint;
  v_linea          jsonb;
  v_linea_id       uuid;
  v_art            articulos%rowtype;
  v_cantidad       numeric(14, 3);
  v_saldo          numeric(14, 3);
  v_series         jsonb;
  v_serie_txt      text;
  v_serie_id       uuid;
  v_serie_estado   estado_serie;
  v_serie_bodega   uuid;
  v_n_lineas       int;
begin
  ---------------------------------------------------------------------------
  -- 1. Rol
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- 2. Cabecera
  ---------------------------------------------------------------------------
  v_n_lineas := jsonb_array_length(coalesce(p -> 'lineas', '[]'::jsonb));
  if v_n_lineas = 0 then
    raise exception 'El movimiento no tiene líneas.';
  end if;

  v_bodega         := (p ->> 'bodega_id')::uuid;
  v_bodega_destino := nullif(p ->> 'bodega_destino_id', '')::uuid;

  insert into movimientos (
    tipo, fecha, bodega_id, documento_id, sala_id, trabajador_id,
    bodega_destino_id, retirado_por, motivo, observacion, creado_por
  ) values (
    v_tipo,
    coalesce(nullif(p ->> 'fecha', '')::date, current_date),
    v_bodega,
    nullif(p ->> 'documento_id', '')::uuid,
    nullif(p ->> 'sala_id', '')::uuid,
    nullif(p ->> 'trabajador_id', '')::uuid,
    v_bodega_destino,
    nullif(trim(p ->> 'retirado_por'), ''),
    nullif(trim(p ->> 'motivo'), ''),
    nullif(trim(p ->> 'observacion'), ''),
    auth.uid()
  )
  returning id, folio into v_mov_id, v_folio;

  ---------------------------------------------------------------------------
  -- 3. Líneas — en orden de artículo, para que dos movimientos simultáneos que
  --    tocan los mismos artículos tomen los bloqueos en el mismo orden y no se
  --    trencen en un deadlock.
  ---------------------------------------------------------------------------
  for v_linea in
    select t.valor
      from jsonb_array_elements(p -> 'lineas') as t(valor)
     order by (t.valor ->> 'articulo_id')
  loop
    select * into v_art from articulos where id = (v_linea ->> 'articulo_id')::uuid;
    if not found then
      raise exception 'El artículo % no existe.', v_linea ->> 'articulo_id';
    end if;
    if not v_art.activo then
      raise exception 'El artículo % (%) está inactivo.', v_art.codigo_defontana, v_art.descripcion;
    end if;

    v_cantidad := (v_linea ->> 'cantidad')::numeric(14, 3);

    if v_cantidad = 0 then
      raise exception 'La cantidad del artículo % no puede ser cero.', v_art.codigo_defontana;
    end if;
    if v_tipo <> 'AJUSTE' and v_cantidad < 0 then
      raise exception 'La cantidad del artículo % debe ser positiva; el signo lo pone el tipo de movimiento.',
        v_art.codigo_defontana;
    end if;

    ---------------------------------------------------------------------------
    -- 3a. Saldo: bloquear, validar, actualizar
    ---------------------------------------------------------------------------
    if v_tipo = 'TRASLADO' then
      -- Ambas bodegas, siempre en el mismo orden, para no cruzarse con un
      -- traslado simultáneo en sentido contrario.
      perform _asegurar_fila_stock(v_art.id, v_bodega);
      perform _asegurar_fila_stock(v_art.id, v_bodega_destino);
      perform 1 from stock_cache
        where articulo_id = v_art.id and bodega_id in (v_bodega, v_bodega_destino)
        order by bodega_id
        for update;
    else
      perform _asegurar_fila_stock(v_art.id, v_bodega);
      perform 1 from stock_cache
        where articulo_id = v_art.id and bodega_id = v_bodega
        for update;
    end if;

    select cantidad into v_saldo
      from stock_cache
     where articulo_id = v_art.id and bodega_id = v_bodega;

    -- Efecto sobre la bodega de origen (para AJUSTE, `cantidad` ya trae su signo).
    if v_tipo in ('ENTRADA', 'DEVOLUCION') then
      update stock_cache set cantidad = cantidad + v_cantidad
       where articulo_id = v_art.id and bodega_id = v_bodega;
    elsif v_tipo = 'AJUSTE' then
      if v_saldo + v_cantidad < 0 then
        raise exception 'El ajuste dejaría el stock de % (%) en %. Saldo actual: %.',
          v_art.codigo_defontana, v_art.descripcion, v_saldo + v_cantidad, v_saldo;
      end if;
      update stock_cache set cantidad = cantidad + v_cantidad
       where articulo_id = v_art.id and bodega_id = v_bodega;
    else
      -- SALIDA_SALA, ENTREGA_EPP, TRASLADO: descuentan del origen.
      if v_saldo < v_cantidad then
        raise exception 'Stock insuficiente de % (%): hay % % y se intentan mover %.',
          v_art.codigo_defontana, v_art.descripcion, v_saldo, v_art.unidad, v_cantidad;
      end if;
      update stock_cache set cantidad = cantidad - v_cantidad
       where articulo_id = v_art.id and bodega_id = v_bodega;

      if v_tipo = 'TRASLADO' then
        update stock_cache set cantidad = cantidad + v_cantidad
         where articulo_id = v_art.id and bodega_id = v_bodega_destino;
      end if;
    end if;

    ---------------------------------------------------------------------------
    -- 3b. La línea
    ---------------------------------------------------------------------------
    insert into movimiento_lineas (
      movimiento_id, articulo_id, cantidad, cantidad_guia, costo_unitario, observacion
    ) values (
      v_mov_id,
      v_art.id,
      v_cantidad,
      nullif(v_linea ->> 'cantidad_guia', '')::numeric(14, 3),
      nullif(v_linea ->> 'costo_unitario', '')::numeric(14, 2),
      nullif(trim(v_linea ->> 'observacion'), '')
    )
    returning id into v_linea_id;

    ---------------------------------------------------------------------------
    -- 3c. Series
    ---------------------------------------------------------------------------
    v_series := coalesce(v_linea -> 'series', '[]'::jsonb);

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

        if v_tipo = 'ENTRADA' or (v_tipo = 'AJUSTE' and v_cantidad > 0) then
          -- Alta de la serie: no puede existir ya para ese artículo.
          if v_serie_id is not null then
            raise exception 'La serie % del artículo % ya está registrada (estado: %).',
              v_serie_txt, v_art.codigo_defontana, v_serie_estado;
          end if;
          insert into series (articulo_id, numero_serie, estado, bodega_id)
          values (v_art.id, v_serie_txt, 'EN_BODEGA', v_bodega)
          returning id into v_serie_id;

        elsif v_tipo = 'DEVOLUCION' then
          if v_serie_id is null then
            raise exception 'La serie % del artículo % no está registrada.', v_serie_txt, v_art.codigo_defontana;
          end if;
          if v_serie_estado <> 'ENTREGADO' then
            raise exception 'La serie % del artículo % no está entregada (estado: %), así que no se puede devolver.',
              v_serie_txt, v_art.codigo_defontana, v_serie_estado;
          end if;
          update series
             set estado = 'DEVUELTO', bodega_id = v_bodega, sala_id = null, trabajador_id = null
           where id = v_serie_id;

        else
          -- SALIDA_SALA, ENTREGA_EPP, TRASLADO y AJUSTE negativo: la serie tiene
          -- que estar realmente en esta bodega.
          if v_serie_id is null then
            raise exception 'La serie % del artículo % no está registrada.', v_serie_txt, v_art.codigo_defontana;
          end if;
          if v_serie_estado not in ('EN_BODEGA', 'DEVUELTO') then
            raise exception 'La serie % del artículo % no está disponible (estado: %).',
              v_serie_txt, v_art.codigo_defontana, v_serie_estado;
          end if;
          if v_serie_bodega is distinct from v_bodega then
            raise exception 'La serie % del artículo % no está en esta bodega.',
              v_serie_txt, v_art.codigo_defontana;
          end if;

          if v_tipo = 'TRASLADO' then
            update series set bodega_id = v_bodega_destino where id = v_serie_id;
          elsif v_tipo = 'AJUSTE' then
            update series set estado = 'BAJA', bodega_id = null where id = v_serie_id;
          else
            update series
               set estado = 'ENTREGADO',
                   bodega_id = null,
                   sala_id = nullif(p ->> 'sala_id', '')::uuid,
                   trabajador_id = nullif(p ->> 'trabajador_id', '')::uuid
             where id = v_serie_id;
          end if;
        end if;

        insert into movimiento_linea_series (linea_id, serie_id) values (v_linea_id, v_serie_id);
      end loop;

    elsif jsonb_array_length(v_series) > 0 then
      raise exception 'El artículo % no se controla por serie, pero se enviaron números de serie.',
        v_art.codigo_defontana;
    end if;
  end loop;

  return jsonb_build_object('movimiento_id', v_mov_id, 'folio', v_folio);
end;
$$;

revoke execute on function registrar_movimiento(jsonb) from public, anon;
grant  execute on function registrar_movimiento(jsonb) to authenticated;

revoke execute on function _asegurar_fila_stock(uuid, uuid) from public, anon, authenticated;
revoke execute on function recalcular_stock() from public, anon;
grant  execute on function recalcular_stock() to authenticated;

comment on function registrar_movimiento(jsonb) is
  'Única puerta de escritura del libro de inventario. Recibe {tipo, fecha, bodega_id, '
  'documento_id, sala_id, trabajador_id, bodega_destino_id, retirado_por, motivo, '
  'observacion, lineas:[{articulo_id, cantidad, cantidad_guia, costo_unitario, '
  'observacion, series:[]}]} y devuelve {movimiento_id, folio}.';
