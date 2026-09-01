-- =============================================================================
-- 0011 — Anular un movimiento por contramovimiento
-- =============================================================================
-- Las migraciones 0001–0010 ya están aplicadas: esto va aparte, no editando aquéllas.
--
-- Un movimiento nunca se edita ni se borra (ver comentario en 0002 sobre la tabla
-- `movimientos`). Hasta ahora esa regla vivía escrita, pero sin ninguna forma real
-- de "deshacer" un movimiento — la columna `movimientos.anula_movimiento_id` existe
-- desde `0001` y nunca se usó. Esta migración la pone a trabajar: `anular_movimiento`
-- registra el movimiento inverso exacto, enlazado por esa columna. El original
-- jamás se toca — ni UPDATE ni DELETE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extraer el núcleo de `registrar_movimiento` a una función interna
-- ---------------------------------------------------------------------------
-- El cuerpo es idéntico al vigente desde `0007`, con dos cambios: (a) recibe y
-- graba `anula_movimiento_id`; (b) un artículo con serie, al reactivarse por un
-- AJUSTE positivo, puede encontrar la serie en estado BAJA en vez de no existir
-- — es el caso de anular un AJUSTE negativo que la dio de baja — y en ese único
-- caso la reactiva en vez de rechazarla como "ya registrada".
--
-- Esta función NUNCA se otorga a `authenticated`/`anon`/`public`: solo la llaman
-- `registrar_movimiento` y `anular_movimiento`, ambas dueñas del mismo propietario,
-- que por serlo conserva el privilegio de ejecutarla aunque esté revocado para
-- todos los demás. Mismo patrón que `_asegurar_fila_stock`.
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
            -- Único camino nuevo respecto de `0007`: un AJUSTE positivo que
            -- encuentra la serie en BAJA la reactiva en vez de rechazarla. Es
            -- lo que permite anular un AJUSTE negativo que la había dado de
            -- baja — el resto de los estados sigue siendo un error, porque una
            -- ENTRADA nunca debe reactivar en silencio una serie existente.
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

-- Wrapper público: misma firma exacta de siempre, así que `create or replace`
-- la reemplaza de verdad (no la sobrecarga) y conserva sus grants.
create or replace function registrar_movimiento(p jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select _registrar_movimiento_interno(p, null);
$$;

revoke execute on function registrar_movimiento(jsonb) from public, anon;
grant  execute on function registrar_movimiento(jsonb) to authenticated;

revoke execute on function _registrar_movimiento_interno(jsonb, uuid) from public, anon, authenticated;

comment on function registrar_movimiento(jsonb) is
  'Única puerta de escritura del libro de inventario. Recibe {tipo, fecha, bodega_id, '
  'documento_id, sala_id, trabajador_id, bodega_destino_id, retirado_por, retirado_por_id, '
  'motivo, observacion, lineas:[{articulo_id, cantidad, cantidad_guia, costo_unitario, '
  'observacion, series:[]}]} y devuelve {movimiento_id, folio}. Envoltorio de una línea '
  'sobre `_registrar_movimiento_interno`, que además usa `anular_movimiento`.';

-- ---------------------------------------------------------------------------
-- 2. `anular_movimiento`: registra el movimiento inverso, nunca toca el original
-- ---------------------------------------------------------------------------
create or replace function anular_movimiento(p_movimiento uuid, p_motivo text)
returns movimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original            movimientos%rowtype;
  v_ya_anulado           boolean;
  v_tipo_reverso         tipo_movimiento;
  v_bodega_reverso       uuid;
  v_bodega_dest_reverso  uuid;
  v_sala_reverso         uuid;
  v_trabajador_reverso   uuid;
  v_motivo_reverso       text;
  v_observacion_reverso  text;
  v_lineas_reverso       jsonb;
  v_payload              jsonb;
  v_resultado            jsonb;
  v_fila                 movimientos%rowtype;
begin
  if not es_admin() then
    raise exception 'Solo un Administrador puede anular movimientos.';
  end if;

  if length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Anular un movimiento exige indicar el motivo.';
  end if;

  -- Bloquea el original: si dos anulaciones concurrentes apuntaran al mismo
  -- movimiento, la segunda espera aquí y, al pasar, el chequeo de "ya fue
  -- anulado" de más abajo ya ve la fila que insertó la primera.
  select * into v_original from movimientos where id = p_movimiento for update;
  if not found then
    raise exception 'El movimiento a anular no existe.';
  end if;

  -- No se anula una anulación. Corregir la corrección con el mismo mapeo de
  -- tipos no garantiza reconstruir el estado exacto en encadenamientos; si
  -- una anulación fue un error, se corrige con un movimiento nuevo.
  if v_original.anula_movimiento_id is not null then
    raise exception 'No se puede anular un movimiento que ya es, en sí mismo, una anulación de otro.';
  end if;

  select exists(select 1 from movimientos where anula_movimiento_id = p_movimiento) into v_ya_anulado;
  if v_ya_anulado then
    raise exception 'Este movimiento ya fue anulado antes; no se puede anular dos veces.';
  end if;

  -- Caso ambiguo: una DEVOLUCION con sala Y trabajador a la vez. La estructura
  -- lo permite (el check exige sala_id o trabajador_id, no exactamente uno)
  -- aunque ninguna pantalla lo produce hoy. Se rechaza en vez de adivinar cuál
  -- de los dos reversar.
  if v_original.tipo = 'DEVOLUCION'
     and v_original.sala_id is not null and v_original.trabajador_id is not null then
    raise exception 'Esta devolución tiene sala y trabajador a la vez; no se puede anular automáticamente.';
  end if;

  -- El reverso de cada tipo es, literalmente, el movimiento que ya existe para
  -- deshacer su efecto — no un tipo nuevo. Anular una ENTRADA usa AJUSTE porque
  -- es el único tipo que resta stock sin sala/trabajador/bodega-destino y exige
  -- motivo: es, en los hechos, una corrección de inventario con motivo.
  v_tipo_reverso := case v_original.tipo
    when 'ENTRADA'     then 'AJUSTE'
    when 'AJUSTE'      then 'AJUSTE'
    when 'SALIDA_SALA' then 'DEVOLUCION'
    when 'ENTREGA_EPP' then 'DEVOLUCION'
    when 'DEVOLUCION'  then case when v_original.sala_id is not null
                                  then 'SALIDA_SALA' else 'ENTREGA_EPP' end
    when 'TRASLADO'    then 'TRASLADO'
  end;

  v_bodega_reverso      := case when v_original.tipo = 'TRASLADO' then v_original.bodega_destino_id else v_original.bodega_id end;
  v_bodega_dest_reverso := case when v_original.tipo = 'TRASLADO' then v_original.bodega_id else null end;

  v_sala_reverso := case
    when v_original.tipo = 'SALIDA_SALA' then v_original.sala_id
    when v_original.tipo = 'DEVOLUCION' and v_original.sala_id is not null then v_original.sala_id
  end;
  v_trabajador_reverso := case
    when v_original.tipo = 'ENTREGA_EPP' then v_original.trabajador_id
    when v_original.tipo = 'DEVOLUCION' and v_original.trabajador_id is not null then v_original.trabajador_id
  end;

  v_motivo_reverso := case when v_tipo_reverso = 'AJUSTE'
    then format('Anulación del movimiento N° %s. Motivo: %s', v_original.folio, p_motivo)
  end;
  v_observacion_reverso :=
    format('Anula el movimiento N° %s (%s). Motivo: %s', v_original.folio, v_original.tipo, p_motivo);

  select jsonb_agg(jsonb_build_object(
           'articulo_id', l.articulo_id,
           -- Solo se invierte el signo si el reverso es un AJUSTE: en los demás
           -- casos el nuevo TIPO ya trae su propio signo (DEVOLUCION suma,
           -- TRASLADO con origen/destino invertidos resta donde antes sumaba),
           -- así que la magnitud se reusa tal cual.
           'cantidad', case when v_tipo_reverso = 'AJUSTE' then -l.cantidad else l.cantidad end,
           'observacion', format('Anula la línea del movimiento N° %s', v_original.folio),
           'series', coalesce(
                       (select jsonb_agg(s.numero_serie)
                          from movimiento_linea_series mls
                          join series s on s.id = mls.serie_id
                         where mls.linea_id = l.id),
                       '[]'::jsonb)
         ))
    into v_lineas_reverso
    from movimiento_lineas l
   where l.movimiento_id = p_movimiento;

  v_payload := jsonb_build_object(
    'tipo', v_tipo_reverso,
    'bodega_id', v_bodega_reverso,
    'bodega_destino_id', v_bodega_dest_reverso,
    'sala_id', v_sala_reverso,
    'trabajador_id', v_trabajador_reverso,
    'motivo', v_motivo_reverso,
    'observacion', v_observacion_reverso,
    'lineas', v_lineas_reverso
  );

  -- Aquí se recalculan saldo, series y bloqueos con la misma lógica de
  -- siempre — `anular_movimiento` no la reimplementa. El movimiento ORIGINAL
  -- nunca se toca, ni con UPDATE ni con DELETE; solo se inserta esta fila nueva.
  v_resultado := _registrar_movimiento_interno(v_payload, p_movimiento);

  select * into v_fila from movimientos where id = (v_resultado ->> 'movimiento_id')::uuid;
  return v_fila;
end;
$$;

revoke execute on function anular_movimiento(uuid, text) from public, anon;
grant  execute on function anular_movimiento(uuid, text) to authenticated;

comment on function anular_movimiento(uuid, text) is
  'Solo ADMIN. Inserta un movimiento inverso enlazado por anula_movimiento_id; '
  'el original jamás se edita ni se borra. No se puede anular dos veces ni '
  'anular una anulación.';

-- ---------------------------------------------------------------------------
-- 3. `v_movimientos`: si es una anulación, y si ya fue anulado
-- ---------------------------------------------------------------------------
-- `m.anula_movimiento_id` ya se expone desde `0007` (columna, no derivada).
-- Lo que falta es el folio legible de a qué anula, y si a este movimiento ya
-- lo anuló otro. `create or replace view` conserva los grants por sí sola con
-- columnas nuevas al final; se reafirman de todos modos por la disciplina ya
-- establecida (la trampa de perder el `grant select` al recrear una vista ya
-- costó dos veces, en `v_movimientos` con `0007` y en `v_stock` con `0009`).
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
         -- Columnas nuevas de esta migración, al final por exigencia de
         -- `create or replace view`.
         (select o.folio from movimientos o where o.id = m.anula_movimiento_id) as anula_folio,
         (select r.id    from movimientos r where r.anula_movimiento_id = m.id) as anulado_por_id,
         (select r.folio from movimientos r where r.anula_movimiento_id = m.id) as anulado_por_folio
    from movimientos m
    join bodegas b            on b.id  = m.bodega_id
    left join bodegas bd      on bd.id = m.bodega_destino_id
    left join salas_electricas s on s.id = m.sala_id
    left join trabajadores t  on t.id  = m.trabajador_id
    left join trabajadores rt on rt.id = m.retirado_por_id
    left join bodega_documentos d on d.id  = m.documento_id
    left join proveedores pv  on pv.id = d.proveedor_id
    left join usuarios pf     on pf.id = m.creado_por;

grant select on v_movimientos to authenticated;
revoke all   on v_movimientos from anon;
