-- =============================================================================
-- 0010 — La foto del artículo
-- =============================================================================
-- Sin cambios respecto del original de Bodega: no toca `documentos` ni
-- `perfiles`. `puede_mover()` ya apunta a `usuarios.rol_bodega` desde 0001.
--
-- El bodeguero reconoce el material por su aspecto, no por el Código Defontana.
-- Una foto por artículo, reemplazable, que sirve para identificarlo en el estante.
--
-- NO es evidencia de una entrega: no documenta qué llegó en una guía ni respalda
-- un faltante. Es un atributo del catálogo, como la marca.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Dónde vive la foto
-- ---------------------------------------------------------------------------
-- Dos columnas y no una con convención de nombres: la miniatura puede faltar (un
-- artículo fotografiado antes de que existiera) y deducir su ruta recortando
-- texto es la clase de acuerdo tácito que se rompe en silencio.
alter table articulos
  add column foto_path           text,
  add column foto_miniatura_path text;

comment on column articulos.foto_path is
  'Ruta dentro del bucket `fotos-articulos`. El bucket es público, así que la URL '
  'se arma sin firmar nada. Se escribe solo por `fijar_foto_articulo`.';

-- ---------------------------------------------------------------------------
-- 2. El bucket, PÚBLICO a propósito
-- ---------------------------------------------------------------------------
-- Al revés que `guias`, que es privado porque una guía escaneada trae RUT del
-- proveedor, precios y direcciones. Esto son fotos de cable y guantes.
--
-- Lo que se gana: las fotos viajan por la red de distribución y el navegador las
-- cachea, así que el tráfico cuenta contra la cuota CON caché del plan gratuito
-- en vez de la cuota sin caché. Con un bucket privado, cada apertura de Stock
-- tendría que firmar decenas de enlaces temporales que, por ser únicos, no se
-- pueden cachear en ningún sitio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos-articulos', 'fotos-articulos', true,
  2097152, -- 2 MB. Tras comprimir en el navegador sobra; esto es el tope duro.
  -- Se aceptan los tres aunque siempre subamos WebP: `canvas.toBlob()` con un
  -- tipo que el navegador no sabe codificar DEVUELVE PNG SIN AVISAR, y una lista
  -- con solo `image/webp` rechazaría la subida sin explicar por qué.
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

create policy "ver fotos de articulos" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos-articulos');

create policy "subir fotos de articulos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-articulos' and puede_mover());

create policy "reemplazar fotos de articulos" on storage.objects
  for update to authenticated
  using      (bucket_id = 'fotos-articulos' and puede_mover())
  with check (bucket_id = 'fotos-articulos' and puede_mover());

-- Diferencia deliberada con `guias`, donde borrar es solo del Administrador
-- porque un escaneo es evidencia. Una foto de producto no lo es: quien reemplaza
-- una foto mal tomada tiene que poder eliminar la anterior, o el bucket se llena
-- de huérfanas que nadie puede limpiar.
create policy "borrar fotos de articulos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-articulos' and puede_mover());

-- ---------------------------------------------------------------------------
-- 3. La única puerta para escribir la foto
-- ---------------------------------------------------------------------------
-- `admin_articulos` (0002) es `for all using (es_admin())`, y la 0007 solo amplió
-- el INSERT a `puede_mover()`. O sea: UN BODEGUERO NO PUEDE HACER `UPDATE` SOBRE
-- `articulos`. Y bajo RLS un UPDATE denegado **no lanza error: afecta cero
-- filas**, así que guardar la foto desde la Recepción parecería funcionar y la
-- foto no aparecería nunca. Hay una prueba en la suite que documenta eso.
--
-- Abrirle el UPDATE no es la salida: RLS es por fila, no por columna, y con ella
-- podría cambiar también el Código Defontana o el stock mínimo de un artículo que
-- ya tiene movimientos — justo lo que la 0007 decidió proteger.
--
-- Por eso una función SECURITY DEFINER que toca SOLO estas dos columnas, verifica
-- el rol y falla con un mensaje de verdad. Mismo patrón que `registrar_movimiento`.
create or replace function fijar_foto_articulo(p_articulo uuid, p_foto text, p_miniatura text)
returns articulos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_art articulos%rowtype;
begin
  if not puede_mover() then
    raise exception 'Tu rol no permite cambiar la foto de un artículo.';
  end if;

  update articulos
     set foto_path           = nullif(trim(p_foto), ''),
         foto_miniatura_path = nullif(trim(p_miniatura), '')
   where id = p_articulo
  returning * into v_art;

  if not found then
    raise exception 'El artículo % no existe.', p_articulo;
  end if;

  return v_art;
end;
$$;

comment on function fijar_foto_articulo(uuid, text, text) is
  'Fija o quita la foto de un artículo. Existe porque el bodeguero no tiene UPDATE '
  'sobre `articulos` y RLS no distingue columnas: sin esta función habría que '
  'darle permiso para cambiar también el código y el stock mínimo. Pasar null en '
  'ambos argumentos quita la foto.';

revoke execute on function fijar_foto_articulo(uuid, text, text) from public, anon;
grant  execute on function fijar_foto_articulo(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. La miniatura llega a la pantalla de Stock
-- ---------------------------------------------------------------------------
-- Va con CREATE OR REPLACE y no con DROP: las columnas nuevas se AGREGAN AL FINAL
-- y las anteriores quedan idénticas en nombre, tipo y orden, que es el único caso
-- en que Postgres lo permite. Así se conservan los `grant` y no se repite la
-- trampa que ya costó dos migraciones (0007 y 0009).
create or replace view v_stock with (security_invoker = true) as
  select a.id     as articulo_id,
         a.codigo_defontana,
         a.descripcion,
         a.tipo,
         a.unidad,
         a.marca,
         a.familia,
         a.controla_serie,
         a.stock_minimo,
         a.activo,
         b.id     as bodega_id,
         b.nombre as bodega,
         s.cantidad,
         s.cantidad < a.stock_minimo as bajo_minimo,
         a.foto_path,
         a.foto_miniatura_path
    from stock_cache s
    join articulos a on a.id = s.articulo_id
    join bodegas   b on b.id = s.bodega_id
   where b.activo;
