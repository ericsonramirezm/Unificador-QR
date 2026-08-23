-- ============================================================
-- Firma digital por usuario (Daily Report).
--
-- Antes, el nombre "Ericson Ramirez" en el bloque de firma del Excel
-- (Coordinador de Terreno) venía escrito fijo en la propia plantilla
-- (DR000_12501191.xlsx) — el mismo nombre salía siempre, sin importar
-- quién hubiera creado el reporte. Con esta columna, generarExcelParteDiario()
-- usa el nombre y la firma_url de quien de verdad creó el reporte
-- (parte.usuario_creador), siempre que tenga rol coordinador — así cada
-- coordinador firma con su propio nombre e imagen. Si el creador es un
-- apr, o es coordinador pero todavía no tiene firma_url, esa celda queda
-- en blanco (sin firma) en vez de mostrar un nombre que no corresponde.
--
-- La imagen de la firma NO se sube a Storage: se sirve como archivo
-- estático desde public/firmas/ (mismo mecanismo ya usado para Ericson/
-- Sara) y acá solo se guarda la ruta. Para agregar la firma de un nuevo
-- coordinador:
--   1. Colocar su imagen en public/firmas/ (ej: public/firmas/nombre.png)
--      y hacer deploy.
--   2. Correr un UPDATE como el de más abajo, con su email y esa ruta.
-- "Administrador Contrato" (Sara Cofré) sigue fija por ahora, no usa esta
-- columna.
-- ============================================================

alter table public.usuarios add column if not exists firma_url text;

comment on column public.usuarios.firma_url is
  'Ruta pública de la imagen de firma digital del usuario (ej: /firmas/ericson-ramirez.png). Se usa en el Daily Report en Excel para coordinadores. NULL = sin firma cargada todavía.';

-- Firma de Ericson Ramirez (ya estaba cargada como firma fija en el Excel
-- desde antes de esta migración — acá solo se formaliza en la tabla).
-- OJO: eramirez@wilug.cl es el correo con el que Ericson entra a
-- Unificador QR (tabla usuarios) — no es el mismo que usa para otras
-- cosas, así que si esto no encuentra ninguna fila, confirmar el email
-- real en la tabla usuarios antes de asumir que es este.
update public.usuarios
set firma_url = '/firmas/ericson-ramirez.png'
where email = 'eramirez@wilug.cl';

-- Cuando llegue la firma del otro coordinador, agregar su imagen en
-- public/firmas/ y descomentar/adaptar esto:
-- update public.usuarios
-- set firma_url = '/firmas/NOMBRE-DEL-ARCHIVO.png'
-- where email = 'EMAIL_DEL_OTRO_COORDINADOR';
