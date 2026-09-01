-- =============================================================================
-- 0012 — Bodega obligatoria por sesión
-- =============================================================================
-- Las migraciones 0001–0011 ya están aplicadas: esto va aparte.
--
-- Un Bodeguero o Prevencionista trabaja físicamente en una sola bodega por
-- turno. Hasta ahora cada pantalla de registro dejaba elegir la bodega suelta,
-- y `registrar_movimiento` confiaba ciegamente en el `bodega_id` que mandara
-- el cliente, sin verificar nada contra quién llama — exactamente el tipo de
-- control que en este proyecto vive en la base, no en la interfaz.
--
-- Diferencia respecto del original de Bodega: la columna `bodega_actual_id`
-- NO se agrega aquí. En el original vivía en `perfiles` y esta misma migración
-- la creaba; en este set adaptado, `perfiles` no existe y la columna nace
-- directamente en `usuarios`, junto con `rol_bodega`, en 0020 — el último
-- archivo del set, para no competir con lo que ya vaya a alterar esa tabla en
-- el propio Unificador-QR. Esta migración solo define la función que la fija
-- (`fijar_bodega_actual`) y la valida (`_registrar_movimiento_interno`); ambas
-- son seguras de crear antes de que la columna exista de verdad porque
-- Postgres no valida las referencias a columnas dentro de un cuerpo
-- `plpgsql`/`sql` al crear la función, solo al ejecutarla — y no se ejecutan
-- hasta que 0001–0020 terminen de aplicarse completas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fijarla — no con un UPDATE directo
-- ---------------------------------------------------------------------------
-- Misma razón que ya resolvió `fijar_foto_articulo`: RLS es por fila, no por
-- columna. Abrirle a un Bodeguero un UPDATE de "su propia fila" en `usuarios`
-- sería peor que no hacer nada, porque ese mismo permiso le dejaría cambiarse
-- también su propio `rol`/`rol_bodega`. Y esto es válido sin importar qué
-- política de UPDATE tenga hoy `usuarios` en el resto de Unificador-QR (hoy
-- solo un Coordinador general puede hacer un UPDATE directo ahí, ver
-- `fix_rls_recursion.sql`/`fix_seguridad_qa.sql`): esta función SECURITY
-- DEFINER es la única vía pensada para que CUALQUIER rol de Bodega, sea o no
-- Coordinador general, fije su propia bodega actual.
create or replace function fijar_bodega_actual(p_bodega uuid)
returns usuarios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activa boolean;
  v_usuario usuarios%rowtype;
begin
  if mi_rol_bodega() is null then
    raise exception 'Tu usuario no tiene acceso al módulo de Bodega.';
  end if;

  select activo into v_activa from bodegas where id = p_bodega;
  if not found or not v_activa then
    raise exception 'Esa bodega no existe o no está activa.';
  end if;

  update usuarios set bodega_actual_id = p_bodega where id = auth.uid()
  returning * into v_usuario;

  return v_usuario;
end;
$$;

revoke execute on function fijar_bodega_actual(uuid) from public, anon;
grant  execute on function fijar_bodega_actual(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. La validación real: dentro del núcleo que ya comparten las tres puertas
--    de escritura (registrar_movimiento, registrar_recepcion, anular_movimiento)
-- ---------------------------------------------------------------------------
-- Se reemplaza `_registrar_movimiento_interno` completa porque agrega una
-- variable declarada y un bloque nuevo — el resto del cuerpo es idéntico al
-- vigente desde `0011`.
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

  -- Bodeguero y Prevencionista solo pueden ORIGINAR un movimiento en la
  -- bodega que eligieron al entrar. Administrador queda exento a propósito:
  -- necesita poder anular un movimiento de cualquier bodega (el `bodega_id`
  -- de la reversa sale del movimiento original, no de la bodega que el admin
  -- tenga elegida) y registrar un AJUSTE de corrección donde haga falta. El
  -- chequeo es solo sobre `v_bodega` (el origen) — nunca sobre
  -- `v_bodega_destino`: un Bodeguero sigue pudiendo trasladar desde su
  -- bodega hacia cualquier otra.
  if v_rol in ('BODEGUERO', 'PREVENCIONISTA') then
    select bodega_actual_id into v_usuario_bodega from usuarios where id = auth.uid();
    if v_usuario_bodega is null then
      raise exception 'Todavía no elegiste una bodega. Elígela desde la barra de la app antes de registrar.';
    end if;
    if v_bodega is distinct from v_usuario_bodega then
      raise exception 'Solo puedes registrar movimientos en tu bodega elegida.';
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
    nullif(p ->> 'documento_id', '')::uuid,
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

    if v_tipo = 'TRASLADO' then
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
          if v_serie_id is not null then
            if v_tipo = 'AJUSTE' and v_serie_estado = 'BAJA' then
              update series
                 set estado = 'EN_BODEGA', bodega_id = v_bodega, sala_id = null, trabajador_id = null
               where id = v_serie_id;
            else
              raise exception 'La serie % del artículo % ya está registrada (estado: %).',
                v_serie_txt, v_art.codigo_defontana, v_serie_estado;
            end if;
          else
            insert into series (articulo_id, numero_serie, estado, bodega_id)
            values (v_art.id, v_serie_txt, 'EN_BODEGA', v_bodega)
            returning id into v_serie_id;
          end if;

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

revoke execute on function _registrar_movimiento_interno(jsonb, uuid) from public, anon, authenticated;

comment on function fijar_bodega_actual(uuid) is
  'Cada usuario fija su propia bodega de trabajo. No es un UPDATE directo: RLS '
  'es por fila, no por columna, y ninguna política general de `usuarios` le da '
  'a un Bodeguero o Prevencionista permiso de UPDATE sobre su propia fila.';
