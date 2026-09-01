-- =============================================================================
-- 0007 — Alta de artículos en recepción, y quién retira el material
-- =============================================================================
-- Las migraciones 0001–0006 ya están aplicadas: esto va aparte, no editando aquéllas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. El bodeguero puede CREAR artículos, no modificarlos
-- ---------------------------------------------------------------------------
-- Si llega material que no está en el catálogo, quien recibe tiene que poder
-- darlo de alta y seguir; obligarlo a llamar al Administrador detiene la
-- descarga del camión.
--
-- El permiso se amplía solo a INSERT. Modificar y desactivar siguen siendo del
-- Administrador (política `admin_articulos`), que es la parte que de verdad
-- importa proteger: un artículo de más es un problema visible y menor, pero que
-- alguien cambie el código o el stock mínimo de uno que ya tiene movimientos
-- descuadra el inventario en silencio.
--
-- Las políticas permisivas se suman con OR, así que esta convive con la de
-- administrador sin quitarle nada.
create policy crear_articulos_al_recibir on articulos
  for insert to authenticated
  with check (puede_mover());

-- ---------------------------------------------------------------------------
-- 2. Quién retira el material de una salida a sala
-- ---------------------------------------------------------------------------
-- NO se reutiliza `trabajador_id`, aunque a primera vista serviría: en el modelo
-- significa *quien recibe EPP*, y la restricción `movimiento_coherente` obliga a
-- que vaya nulo en una SALIDA_SALA. Son dos hechos distintos —quién retira
-- material para una sala y quién recibe su equipo de protección— y mezclarlos
-- rompería el sentido de los seis tipos de movimiento.
alter table movimientos
  add column retirado_por_id uuid references trabajadores (id);

comment on column movimientos.retirado_por_id is
  'Trabajador de la nómina que retira el material. La columna de texto '
  '`retirado_por` se conserva para quien no está en la nómina.';

create index movimientos_retirado_por_idx
  on movimientos (retirado_por_id) where retirado_por_id is not null;

-- ---------------------------------------------------------------------------
-- 3. `registrar_movimiento` tiene que conocer la columna nueva
-- ---------------------------------------------------------------------------
-- Se reemplaza completa porque la cabecera se inserta con lista explícita de
-- columnas. El cuerpo es idéntico al de 0003 salvo `retirado_por_id`.
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
    bodega_destino_id, retirado_por, retirado_por_id, motivo, observacion, creado_por
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

-- ---------------------------------------------------------------------------
-- 4. La vista de movimientos muestra quién retiró
-- ---------------------------------------------------------------------------
-- `create or replace view` solo admite columnas nuevas al final, así que se
-- agregan ahí. Y hay que volver a otorgar el permiso: un `drop` lo perdería.
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
         -- Columnas nuevas, al final por exigencia de `create or replace view`.
         d.origen,
         d.origen_nombre,
         m.retirado_por_id,
         rt.nombre  as retirado_por_nombre
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
