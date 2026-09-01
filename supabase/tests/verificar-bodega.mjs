/**
 * Verificación del esquema de Bodega fusionado dentro de Unificador-QR, sobre
 * Postgres real (PGlite, WASM).
 *
 * Adaptado de Bodega/bodega-app/supabase/tests/verificar.mjs (Fase 0 del plan
 * de fusión: "en-el-modulo-compras-pure-harp"). Aplica el set de migraciones
 * adaptado de `supabase/migrations/bodega/` (0001…0020) sobre una simulación
 * mínima de lo que YA aporta el proyecto Supabase real de Unificador-QR
 * (esquema `auth`, esquema `storage`, roles `anon`/`authenticated`, y una
 * tabla `usuarios` mínima) y corre las mismas ~92 comprobaciones del arnés
 * original, adaptadas, más los casos nuevos específicos de la fusión de roles.
 *
 * No toca ningún Supabase real (ni el de Bodega ni el de Unificador-QR).
 * Corre con `npm run verificar-bodega`.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const dirMigraciones = join(aqui, '..', 'migrations', 'bodega')

const db = new PGlite()

/**
 * Supabase aporta el esquema `auth`, el esquema `storage` y los roles `anon` /
 * `authenticated`. PGlite no los trae, así que se reconstruyen aquí lo mínimo
 * para que las migraciones corran igual que en producción.
 *
 * Además, a diferencia del arnés original de Bodega, aquí se crea una tabla
 * `usuarios` MÍNIMA que imita la real de Unificador-QR — columnas
 * `id`/`email`/`nombre`/`rol`/`estado`, más lo que agrega la propia migración
 * 0020 (`rol_bodega`/`bodega_actual_id`). Unificador-QR YA TIENE esta tabla en
 * producción, con más columnas (firma_url, etc.) y su propia RLS — no se
 * replica toda esa lógica aquí, solo lo mínimo que el esquema de Bodega
 * necesita para correr:
 *
 *   - `usuarios_leer_todos`: cualquiera puede leer cualquier fila. Sirve para
 *     que los `left join usuarios` de `v_movimientos`/`v_pendientes`
 *     (`registrado_por`, `resuelto_por_nombre`, `editado_por_nombre`) siempre
 *     resuelvan un nombre, sin replicar las políticas de visibilidad reales
 *     de Unificador-QR (que no son asunto de Bodega).
 *   - SIN ninguna política de INSERT/UPDATE/DELETE para `authenticated`. En
 *     la Unificador-QR real, solo un Coordinador general puede hacer un
 *     UPDATE directo sobre `usuarios` (`fix_rls_recursion.sql`/
 *     `fix_seguridad_qa.sql`) y el alta pasa por la política
 *     `usuarios_crear_propio` — ninguna de las dos hace falta replicarla acá.
 *     Lo único que este arnés necesita garantizar es que NINGÚN rol de
 *     Bodega pueda escribir `rol_bodega`/`bodega_actual_id` por fuera de
 *     `fijar_rol_bodega`/`fijar_bodega_actual`, y "sin política de UPDATE"
 *     ya lo garantiza: bajo RLS, sin política que aplique, el UPDATE no
 *     lanza error, afecta cero filas — la misma asimetría que ya prueba el
 *     resto del arnés para `articulos`/`bodegas`.
 *   - El alta de un usuario en las pruebas se simula tal como ocurre de
 *     verdad en Unificador-QR: dos INSERT separados (`auth.users` y luego
 *     `usuarios`, ver `crearUsuarioUnificadorQR`), NUNCA un trigger sobre
 *     `auth.users` — porque no existe ninguno, ni en Unificador-QR ni en este
 *     set de migraciones adaptado (ver el encabezado de 0020).
 */
async function prepararEntornoSupabase() {
  await db.exec(`
    create schema if not exists auth;
    create schema if not exists storage;

    create table auth.users (
      id                 uuid primary key default gen_random_uuid(),
      email              text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );

    -- Igual que en Supabase: el uid sale del claim del JWT.
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table storage.buckets (
      id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text, name text, owner uuid
    );
    alter table storage.objects enable row level security;

    create role anon;
    create role authenticated;
    grant usage on schema public, storage to anon, authenticated;
    alter default privileges in schema public
      grant select, insert, update, delete on tables to authenticated;
    alter default privileges in schema public grant select on tables to anon;
    grant select, insert, update, delete on storage.objects to authenticated;

    -- Tabla mínima que imita "usuarios" de Unificador-QR (ver comentario de
    -- cabecera). Se crea DESPUÉS de "alter default privileges" a propósito,
    -- para heredar los mismos grants por omisión que cualquier otra tabla del
    -- esquema public — igual orden que en la Unificador-QR real, donde
    -- "usuarios" ya existe antes de que se apliquen las migraciones de Bodega.
    create table usuarios (
      id         uuid primary key references auth.users (id),
      email      text,
      nombre     text,
      rol        text not null default 'consultor',
      estado     text not null default 'activo',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table usuarios enable row level security;
    create policy usuarios_leer_todos on usuarios for select using (true);
  `)
}

async function aplicarMigraciones() {
  const archivos = readdirSync(dirMigraciones).filter((f) => f.endsWith('.sql')).sort()
  for (const archivo of archivos) {
    try {
      await db.exec(readFileSync(join(dirMigraciones, archivo), 'utf8'))
    } catch (e) {
      throw new Error(`Migración ${archivo} falló: ${e.message}`)
    }
  }
  return archivos
}

// --- utilidades de sesión -----------------------------------------------------

/** Ejecuta `fn` como un usuario autenticado concreto, con RLS aplicándose. */
async function como(uid, fn) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; set request.jwt.claim.sub = '';`)
  }
}

/** Espera que `fn` falle, y que el mensaje contenga `fragmento`. */
async function debeFallar(fn, fragmento) {
  let error = null
  try {
    await fn()
  } catch (e) {
    error = e
  }
  if (!error) throw new Error(`Se esperaba un error que contuviera "${fragmento}", pero no falló`)
  if (!error.message.toLowerCase().includes(fragmento.toLowerCase())) {
    throw new Error(`Se esperaba "${fragmento}", pero el error fue: ${error.message}`)
  }
}

const mover = (uid, payload) =>
  como(uid, () => db.query(`select registrar_movimiento($1::jsonb) as r`, [JSON.stringify(payload)]))

/** `anular_movimiento` devuelve `movimientos`: `select * from` expande sus columnas. */
const anular = (uid, movimientoId, motivo) =>
  como(uid, () => db.query(`select * from anular_movimiento($1::uuid, $2)`, [movimientoId, motivo]))

const fijarBodegaActual = (uid, bodegaId) =>
  como(uid, () => db.query(`select * from fijar_bodega_actual($1::uuid)`, [bodegaId]))

/** `fijar_rol_bodega` devuelve `usuarios`. `p_rol` puede ser null (quita el acceso). */
const fijarRolBodega = (uid, usuarioId, rol) =>
  como(uid, () => db.query(`select * from fijar_rol_bodega($1::uuid, $2)`, [usuarioId, rol]))

async function unaFila(sql, params = []) {
  const { rows } = await db.query(sql, params)
  return rows[0]
}

const saldo = async (articuloId, bodegaId) =>
  Number(
    (
      await unaFila(`select coalesce(cantidad, 0) as c from stock_cache where articulo_id = $1 and bodega_id = $2`, [
        articuloId,
        bodegaId,
      ])
    )?.c ?? 0,
  )

/**
 * Simula el alta client-driven de un usuario de Unificador-QR: `auth.signUp()`
 * y, justo después, el INSERT explícito en `usuarios` que hace el frontend
 * (nunca un trigger — ver el comentario de cabecera de 0020). `rol_bodega`/
 * `bodega_actual_id` no se mencionan, así que nacen NULL por sí solos.
 */
async function crearUsuarioUnificadorQR(email, nombre, { rol = 'consultor', estado = 'activo' } = {}) {
  const { id } = await unaFila(`insert into auth.users (email) values ($1) returning id`, [email])
  await db.query(`insert into usuarios (id, email, nombre, rol, estado) values ($1, $2, $3, $4, $5)`, [
    id,
    email,
    nombre,
    rol,
    estado,
  ])
  return id
}

// --- casos --------------------------------------------------------------------

const casos = []
const prueba = (nombre, fn) => casos.push({ nombre, fn })

const ctx = {}

prueba('las migraciones aplican sobre Postgres limpio', async () => {
  const archivos = await aplicarMigraciones()
  if (archivos.length < 19) throw new Error(`Solo se encontraron ${archivos.length} migraciones`)
})

prueba('se pueden sembrar usuarios (alta client-driven, sin trigger), roles y catálogos', async () => {
  // Sin trigger sobre auth.users: cada persona nace vía dos INSERT (como haría
  // el frontend real), y CERO acceso a Bodega hasta que alguien se lo dé.
  const nuevos = {}
  for (const [clave, correo, nombre] of [
    ['admin', 'admin@wilug.cl', 'Admin Bodega'],
    ['bodeguero', 'bodega@wilug.cl', 'Bodeguero Uno'],
    ['consulta', 'oficina@wilug.cl', 'Consulta Oficina'],
    ['prevencionista', 'prevencion@wilug.cl', 'Prevencionista Uno'],
  ]) {
    nuevos[clave] = await crearUsuarioUnificadorQR(correo, nombre)
  }
  Object.assign(ctx, nuevos)

  const { rows: sinAcceso } = await db.query(
    `select rol_bodega, bodega_actual_id from usuarios where id in ($1,$2,$3,$4)`,
    [ctx.admin, ctx.bodeguero, ctx.consulta, ctx.prevencionista],
  )
  if (sinAcceso.length !== 4) throw new Error(`Se esperaban 4 usuarios sembrados, hay ${sinAcceso.length}`)
  for (const f of sinAcceso) {
    if (f.rol_bodega !== null || f.bodega_actual_id !== null) {
      throw new Error(`Un usuario recién creado nació con acceso a Bodega: ${JSON.stringify(f)}`)
    }
  }

  // El primer ADMIN de Bodega se fija a mano (bootstrap) — nadie puede llamar
  // todavía a fijar_rol_bodega porque nadie es ADMIN. Mismo principio que ya
  // usa Unificador-QR para su primer Coordinador.
  await db.query(`update usuarios set rol_bodega = 'ADMIN' where id = $1`, [ctx.admin])

  // De ahí en más, el propio ADMIN reparte los demás roles con
  // fijar_rol_bodega — esto además prueba su camino feliz.
  await fijarRolBodega(ctx.admin, ctx.bodeguero, 'BODEGUERO')
  await fijarRolBodega(ctx.admin, ctx.prevencionista, 'PREVENCIONISTA')
  await fijarRolBodega(ctx.admin, ctx.consulta, 'CONSULTA')

  const rolAdmin = await unaFila(`select rol_bodega from usuarios where id = $1`, [ctx.admin])
  if (rolAdmin.rol_bodega !== 'ADMIN') throw new Error(`El bootstrap del ADMIN no quedó: ${rolAdmin.rol_bodega}`)

  ctx.bodega = (await unaFila(`insert into bodegas (nombre) values ('Bodega Central') returning id`)).id
  ctx.bodegaFaena = (await unaFila(`insert into bodegas (nombre) values ('Bodega Faena') returning id`)).id
  // Desde 0012, Bodeguero y Prevencionista solo pueden originar movimientos en
  // la bodega que tienen elegida. El resto del archivo asume que trabajan en
  // `ctx.bodega`, así que se fija aquí con un UPDATE directo (la propia
  // función `fijar_bodega_actual` tiene su sección dedicada más abajo).
  await db.query(`update usuarios set bodega_actual_id = $1 where id in ($2, $3)`, [
    ctx.bodega, ctx.bodeguero, ctx.prevencionista,
  ])
  ctx.sala = (await unaFila(`insert into salas_electricas (nombre) values ('Sala Eléctrica 2') returning id`)).id
  ctx.trabajador = (
    await unaFila(`insert into trabajadores (rut, nombre, cargo) values ('11.111.111-1','Juan Pérez','Eléctrico') returning id`)
  ).id
  ctx.proveedor = (await unaFila(`insert into proveedores (rut, nombre) values ('76.543.210-K','Dimeiggs SPA') returning id`)).id
})

prueba('el Código Defontana duplicado se rechaza, incluso con otra caja o espacios', async () => {
  ctx.cable = (
    await unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, unidad, stock_minimo)
       values ('cbl-4mm ', 'Cable EVA 4mm² rojo', 'MATERIAL', 'MT', 50) returning id`,
    )
  ).id

  // Se normaliza al guardar: queda en mayúsculas y sin espacios.
  const guardado = await unaFila(`select codigo_defontana from articulos where id = $1`, [ctx.cable])
  if (guardado.codigo_defontana !== 'CBL-4MM') {
    throw new Error(`El código no se normalizó: quedó "${guardado.codigo_defontana}"`)
  }

  await debeFallar(
    () => db.query(`insert into articulos (codigo_defontana, descripcion, tipo) values ('CBL-4MM','Otro cable','MATERIAL')`),
    'articulos_codigo_defontana_uq',
  )
  await debeFallar(
    () => db.query(`insert into articulos (codigo_defontana, descripcion, tipo) values ('  cbl-4mm  ','Otro más','MATERIAL')`),
    'articulos_codigo_defontana_uq',
  )

  ctx.panel = (
    await unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, marca, controla_serie)
       values ('PNL-NOT-01','Panel de Control de Incendio','MATERIAL','Notifier',true) returning id`,
    )
  ).id
  ctx.guantes = (
    await unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, unidad, stock_minimo)
       values ('EPP-GNT-01','Guantes dieléctricos clase 0','EPP','PAR',10) returning id`,
    )
  ).id
})

prueba('una entrada por guía de despacho suma stock', async () => {
  ctx.guia = (
    await como(ctx.bodeguero, () =>
      unaFila(
        `insert into bodega_documentos (tipo, folio, proveedor_id, fecha, orden_compra, creado_por)
         values ('GUIA_DESPACHO','19208',$1,current_date,'OC-4471',$2) returning id`,
        [ctx.proveedor, ctx.bodeguero],
      ),
    )
  ).id

  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodega,
    documento_id: ctx.guia,
    lineas: [
      { articulo_id: ctx.cable, cantidad: 500, cantidad_guia: 500 },
      { articulo_id: ctx.guantes, cantidad: 20, cantidad_guia: 24 }, // llegaron menos
    ],
  })

  const c = await saldo(ctx.cable, ctx.bodega)
  const g = await saldo(ctx.guantes, ctx.bodega)
  if (c !== 500) throw new Error(`Cable: se esperaban 500, hay ${c}`)
  if (g !== 20) throw new Error(`Guantes: el stock debe usar lo recibido (20), no lo de la guía (24). Hay ${g}`)
})

prueba('la diferencia entre lo recibido y la guía queda marcada', async () => {
  const mov = await unaFila(`select tiene_diferencia from v_movimientos where tipo = 'ENTRADA' order by folio desc limit 1`)
  if (mov.tiene_diferencia !== true) throw new Error('La recepción con diferencia no quedó marcada')

  const linea = await unaFila(
    `select diferencia from v_movimiento_lineas where articulo_id = $1 and movimiento_tipo = 'ENTRADA'`,
    [ctx.guantes],
  )
  if (Number(linea.diferencia) !== -4) throw new Error(`La diferencia debería ser -4, es ${linea.diferencia}`)
})

prueba('una salida a sala eléctrica descuenta', async () => {
  await mover(ctx.bodeguero, {
    tipo: 'SALIDA_SALA',
    bodega_id: ctx.bodega,
    sala_id: ctx.sala,
    retirado_por: 'Juan Pérez',
    lineas: [{ articulo_id: ctx.cable, cantidad: 120 }],
  })
  const c = await saldo(ctx.cable, ctx.bodega)
  if (c !== 380) throw new Error(`Cable: se esperaban 380, hay ${c}`)
})

prueba('el stock nunca queda negativo y el movimiento fallido no deja rastro', async () => {
  const antes = await unaFila(`select count(*)::int as n from movimientos`)
  await debeFallar(
    () =>
      mover(ctx.bodeguero, {
        tipo: 'SALIDA_SALA',
        bodega_id: ctx.bodega,
        sala_id: ctx.sala,
        lineas: [{ articulo_id: ctx.cable, cantidad: 9999 }],
      }),
    'Stock insuficiente',
  )
  const despues = await unaFila(`select count(*)::int as n from movimientos`)
  if (antes.n !== despues.n) throw new Error('Un movimiento rechazado dejó la cabecera insertada')
  const c = await saldo(ctx.cable, ctx.bodega)
  if (c !== 380) throw new Error(`El saldo cambió tras un movimiento fallido: ${c}`)
})

prueba('el rol Consulta no puede mover inventario ni tocar catálogos', async () => {
  await debeFallar(
    () =>
      mover(ctx.consulta, {
        tipo: 'SALIDA_SALA',
        bodega_id: ctx.bodega,
        sala_id: ctx.sala,
        lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
      }),
    'no permite registrar movimientos',
  )
  await debeFallar(
    () =>
      como(ctx.consulta, () =>
        db.query(`insert into articulos (codigo_defontana, descripcion, tipo) values ('X-1','Colado','MATERIAL')`),
      ),
    'row-level security',
  )
})

prueba('nadie puede escribir el libro directamente, saltándose la función', async () => {
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(`insert into movimientos (tipo, bodega_id, sala_id, creado_por) values ('SALIDA_SALA',$1,$2,$3)`, [
          ctx.bodega,
          ctx.sala,
          ctx.bodeguero,
        ]),
      ),
    'permission denied',
  )
  await debeFallar(
    () => como(ctx.bodeguero, () => db.query(`update stock_cache set cantidad = 99999`)),
    'permission denied',
  )
})

prueba('el prevencionista entrega EPP pero no material a una sala', async () => {
  await mover(ctx.prevencionista, {
    tipo: 'ENTREGA_EPP',
    bodega_id: ctx.bodega,
    trabajador_id: ctx.trabajador,
    lineas: [{ articulo_id: ctx.guantes, cantidad: 2 }],
  })
  const g = await saldo(ctx.guantes, ctx.bodega)
  if (g !== 18) throw new Error(`Guantes: se esperaban 18, hay ${g}`)

  await debeFallar(
    () =>
      mover(ctx.prevencionista, {
        tipo: 'SALIDA_SALA',
        bodega_id: ctx.bodega,
        sala_id: ctx.sala,
        lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
      }),
    'no permite registrar movimientos',
  )
})

prueba('el historial de EPP por trabajador refleja lo entregado', async () => {
  const f = await unaFila(`select trabajador, cantidad_vigente from v_epp_por_trabajador where trabajador_id = $1`, [
    ctx.trabajador,
  ])
  if (!f || Number(f.cantidad_vigente) !== 2) {
    throw new Error(`El historial de EPP no cuadra: ${JSON.stringify(f)}`)
  }
})

prueba('las series se dan de alta al recibir y se exige una por unidad', async () => {
  await debeFallar(
    () =>
      mover(ctx.bodeguero, {
        tipo: 'ENTRADA',
        bodega_id: ctx.bodega,
        documento_id: ctx.guia,
        lineas: [{ articulo_id: ctx.panel, cantidad: 3, series: ['SN-4471', 'SN-4472'] }],
      }),
    'se esperaban 3 número(s) de serie',
  )

  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodega,
    documento_id: ctx.guia,
    lineas: [{ articulo_id: ctx.panel, cantidad: 3, series: ['SN-4471', 'sn-4472', ' SN-4473 '] }],
  })

  const n = await unaFila(`select count(*)::int as n from series where articulo_id = $1 and estado = 'EN_BODEGA'`, [
    ctx.panel,
  ])
  if (n.n !== 3) throw new Error(`Se esperaban 3 series en bodega, hay ${n.n}`)

  // La misma serie no se puede recibir dos veces para el mismo artículo.
  await debeFallar(
    () =>
      mover(ctx.bodeguero, {
        tipo: 'ENTRADA',
        bodega_id: ctx.bodega,
        documento_id: ctx.guia,
        lineas: [{ articulo_id: ctx.panel, cantidad: 1, series: ['SN-4471'] }],
      }),
    'ya está registrada',
  )
})

prueba('al entregar una serie se sabe dónde quedó, y no puede salir dos veces', async () => {
  await mover(ctx.bodeguero, {
    tipo: 'SALIDA_SALA',
    bodega_id: ctx.bodega,
    sala_id: ctx.sala,
    lineas: [{ articulo_id: ctx.panel, cantidad: 1, series: ['SN-4471'] }],
  })

  const s = await unaFila(`select estado, ubicacion_actual from v_series where numero_serie = 'SN-4471'`)
  if (s.estado !== 'ENTREGADO' || s.ubicacion_actual !== 'Sala Eléctrica 2') {
    throw new Error(`La serie 4471 quedó como ${JSON.stringify(s)}`)
  }

  await debeFallar(
    () =>
      mover(ctx.bodeguero, {
        tipo: 'SALIDA_SALA',
        bodega_id: ctx.bodega,
        sala_id: ctx.sala,
        lineas: [{ articulo_id: ctx.panel, cantidad: 1, series: ['SN-4471'] }],
      }),
    'no está disponible',
  )
})

prueba('la devolución reingresa stock y devuelve la serie a bodega', async () => {
  await mover(ctx.bodeguero, {
    tipo: 'DEVOLUCION',
    bodega_id: ctx.bodega,
    sala_id: ctx.sala,
    lineas: [
      { articulo_id: ctx.cable, cantidad: 20 },
      { articulo_id: ctx.panel, cantidad: 1, series: ['SN-4471'] },
    ],
  })

  const c = await saldo(ctx.cable, ctx.bodega)
  if (c !== 400) throw new Error(`Cable tras la devolución: se esperaban 400, hay ${c}`)

  const s = await unaFila(`select estado, ubicacion_actual from v_series where numero_serie = 'SN-4471'`)
  if (s.estado !== 'DEVUELTO' || s.ubicacion_actual !== 'Bodega Central') {
    throw new Error(`La serie devuelta quedó como ${JSON.stringify(s)}`)
  }
})

prueba('el traslado mueve entre bodegas sin cambiar el total', async () => {
  const totalAntes = (await saldo(ctx.cable, ctx.bodega)) + (await saldo(ctx.cable, ctx.bodegaFaena))

  await mover(ctx.bodeguero, {
    tipo: 'TRASLADO',
    bodega_id: ctx.bodega,
    bodega_destino_id: ctx.bodegaFaena,
    lineas: [{ articulo_id: ctx.cable, cantidad: 100 }],
  })

  const central = await saldo(ctx.cable, ctx.bodega)
  const faena = await saldo(ctx.cable, ctx.bodegaFaena)
  if (central !== 300) throw new Error(`Central: se esperaban 300, hay ${central}`)
  if (faena !== 100) throw new Error(`Faena: se esperaban 100, hay ${faena}`)
  if (central + faena !== totalAntes) throw new Error('Un traslado alteró el total de la empresa')
})

prueba('solo el Administrador ajusta inventario, y el ajuste no deja saldo negativo', async () => {
  await debeFallar(
    () =>
      mover(ctx.bodeguero, {
        tipo: 'AJUSTE',
        bodega_id: ctx.bodega,
        motivo: 'Inventario físico',
        lineas: [{ articulo_id: ctx.cable, cantidad: -5 }],
      }),
    'Solo un Administrador',
  )

  await debeFallar(
    () =>
      mover(ctx.admin, {
        tipo: 'AJUSTE',
        bodega_id: ctx.bodega,
        motivo: 'Inventario físico',
        lineas: [{ articulo_id: ctx.cable, cantidad: -99999 }],
      }),
    'dejaría el stock',
  )

  await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodega,
    motivo: 'Inventario físico: merma de 3 metros',
    lineas: [{ articulo_id: ctx.cable, cantidad: -3 }],
  })
  const c = await saldo(ctx.cable, ctx.bodega)
  if (c !== 297) throw new Error(`Cable tras el ajuste: se esperaban 297, hay ${c}`)
})

prueba('un ajuste sin motivo se rechaza en la estructura', async () => {
  await debeFallar(
    () =>
      mover(ctx.admin, {
        tipo: 'AJUSTE',
        bodega_id: ctx.bodega,
        lineas: [{ articulo_id: ctx.cable, cantidad: -1 }],
      }),
    'movimiento_coherente',
  )
})

prueba('una entrada sin guía de despacho se rechaza en la estructura', async () => {
  await debeFallar(
    () =>
      mover(ctx.bodeguero, {
        tipo: 'ENTRADA',
        bodega_id: ctx.bodega,
        lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
      }),
    'movimiento_coherente',
  )
})

prueba('no se puede recibir dos veces la misma guía del mismo proveedor', async () => {
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(
          `insert into bodega_documentos (tipo, folio, proveedor_id, fecha, creado_por)
           values ('GUIA_DESPACHO','19208',$1,current_date,$2)`,
          [ctx.proveedor, ctx.bodeguero],
        ),
      ),
    'bodega_documentos_folio_uq',
  )
})

prueba('un traslado interno se registra sin proveedor', async () => {
  ctx.guiaInterna = (
    await como(ctx.bodeguero, () =>
      unaFila(
        `insert into bodega_documentos (tipo, folio, fecha, origen, origen_nombre, creado_por)
         values ('GUIA_DESPACHO','26423',current_date,'TRASLADO_INTERNO','Bodega Central Coquimbo',$1)
         returning id`,
        [ctx.bodeguero],
      ),
    )
  ).id
  if (!ctx.guiaInterna) throw new Error('No se pudo registrar el traslado interno')
})

prueba('la misma guía interna no se puede recibir dos veces', async () => {
  // Antes de la migración 0006 esto PASABA: el índice de folio era parcial
  // (`where proveedor_id is not null`), así que los traslados internos —que no
  // tienen proveedor— quedaban fuera de la unicidad y se podían duplicar.
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(
          `insert into bodega_documentos (tipo, folio, fecha, origen, creado_por)
           values ('GUIA_DESPACHO','26423',current_date,'TRASLADO_INTERNO',$1)`,
          [ctx.bodeguero],
        ),
      ),
    'bodega_documentos_folio_uq',
  )
})

prueba('una compra externa sin proveedor se rechaza', async () => {
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(
          `insert into bodega_documentos (tipo, folio, fecha, origen, creado_por)
           values ('GUIA_DESPACHO','99999',current_date,'COMPRA_EXTERNA',$1)`,
          [ctx.bodeguero],
        ),
      ),
    'documento_origen_coherente',
  )
})

prueba('una entrada puede respaldarse en un traslado interno', async () => {
  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodega,
    documento_id: ctx.guiaInterna,
    lineas: [{ articulo_id: ctx.cable, cantidad: 50, cantidad_guia: 50 }],
  })
  const c = await saldo(ctx.cable, ctx.bodega)
  if (c !== 347) throw new Error(`Cable tras el traslado interno: se esperaban 347, hay ${c}`)
})

prueba('la recepción crea guía y entrada en una sola operación', async () => {
  const r = await como(ctx.bodeguero, () =>
    db.query(`select registrar_recepcion($1::jsonb) as r`, [
      JSON.stringify({
        documento: { folio: '26426', fecha: null, origen: 'TRASLADO_INTERNO', origen_nombre: 'Bodega Central Coquimbo' },
        bodega_id: ctx.bodega,
        lineas: [{ articulo_id: ctx.guantes, cantidad: 6, cantidad_guia: 6 }],
      }),
    ]),
  )
  if (!r.rows[0].r.movimiento_id) throw new Error('La recepción no devolvió el movimiento')
  const g = await saldo(ctx.guantes, ctx.bodega)
  if (g !== 24) throw new Error(`Guantes tras la recepción: se esperaban 24, hay ${g}`)
})

prueba('si la recepción falla, la guía NO queda huérfana', async () => {
  const antes = await unaFila(`select count(*)::int as n from bodega_documentos`)
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(`select registrar_recepcion($1::jsonb) as r`, [
          JSON.stringify({
            documento: { folio: '26999', origen: 'TRASLADO_INTERNO' },
            bodega_id: ctx.bodega,
            // La serie SN-4472 ya existe: el movimiento debe fallar entero.
            lineas: [{ articulo_id: ctx.panel, cantidad: 1, series: ['SN-4472'] }],
          }),
        ]),
      ),
    'ya está registrada',
  )
  const despues = await unaFila(`select count(*)::int as n from bodega_documentos`)
  if (antes.n !== despues.n) throw new Error('Quedó una guía huérfana tras una recepción fallida')

  // Y por lo tanto el folio se puede volver a usar en el reintento.
  const r = await como(ctx.bodeguero, () =>
    db.query(`select registrar_recepcion($1::jsonb) as r`, [
      JSON.stringify({
        documento: { folio: '26999', origen: 'TRASLADO_INTERNO' },
        bodega_id: ctx.bodega,
        lineas: [{ articulo_id: ctx.panel, cantidad: 1, series: ['SN-9001'] }],
      }),
    ]),
  )
  if (!r.rows[0].r.movimiento_id) throw new Error('El reintento con el mismo folio no funcionó')
})

prueba('el rol Consulta no puede registrar una recepción', async () => {
  await debeFallar(
    () =>
      como(ctx.consulta, () =>
        db.query(`select registrar_recepcion($1::jsonb) as r`, [
          JSON.stringify({
            documento: { folio: '27000', origen: 'TRASLADO_INTERNO' },
            bodega_id: ctx.bodega,
            lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
          }),
        ]),
      ),
    'no permite registrar recepciones',
  )
})

prueba('el bodeguero puede CREAR un artículo pero no modificarlo', async () => {
  const nuevo = await como(ctx.bodeguero, () =>
    unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, unidad)
       values ('BOD-NUEVO-01','Artículo creado durante una recepción','MATERIAL','UN') returning id`,
    ),
  )
  if (!nuevo?.id) throw new Error('El bodeguero no pudo crear el artículo')

  // Crear sí; cambiarle el código o el mínimo a uno existente, no.
  //
  // Ojo con la forma de comprobarlo: la RLS **no lanza error** en un UPDATE que
  // no le corresponde al usuario — la política `using` simplemente hace que
  // ninguna fila coincida, y el UPDATE termina bien habiendo cambiado cero filas.
  // Solo el INSERT lanza, porque ahí se viola un `with check`. Un frontend que
  // no mire las filas afectadas mostraría "guardado" sin haber guardado nada.
  const r = await como(ctx.bodeguero, () =>
    db.query(`update articulos set stock_minimo = 999 where id = $1`, [nuevo.id]),
  )
  if (r.affectedRows > 0) throw new Error('El bodeguero pudo modificar un artículo')

  const despues = await unaFila(`select stock_minimo from articulos where id = $1`, [nuevo.id])
  if (Number(despues.stock_minimo) !== 0) {
    throw new Error(`El mínimo cambió a ${despues.stock_minimo}: la RLS de UPDATE no está protegiendo`)
  }
})

prueba('el rol Consulta sigue sin poder crear artículos', async () => {
  await debeFallar(
    () =>
      como(ctx.consulta, () =>
        db.query(`insert into articulos (codigo_defontana, descripcion, tipo) values ('X-CONSULTA','No','MATERIAL')`),
      ),
    'row-level security',
  )
})

prueba('una salida a sala registra quién retiró, ligado a la nómina', async () => {
  await mover(ctx.bodeguero, {
    tipo: 'SALIDA_SALA',
    bodega_id: ctx.bodega,
    sala_id: ctx.sala,
    retirado_por_id: ctx.trabajador,
    lineas: [{ articulo_id: ctx.cable, cantidad: 10 }],
  })
  const f = await unaFila(
    `select retirado_por_id, retirado_por_nombre from v_movimientos where tipo = 'SALIDA_SALA' order by folio desc limit 1`,
  )
  if (f.retirado_por_id !== ctx.trabajador) throw new Error('No se guardó el trabajador que retiró')
  if (f.retirado_por_nombre !== 'Juan Pérez') throw new Error(`La vista trae "${f.retirado_por_nombre}"`)
})

prueba('la vista de movimientos expone el origen de la guía', async () => {
  const f = await unaFila(
    `select origen, origen_nombre from v_movimientos where documento_id = $1`,
    [ctx.guiaInterna],
  )
  if (f.origen !== 'TRASLADO_INTERNO' || f.origen_nombre !== 'Bodega Central Coquimbo') {
    throw new Error(`Origen incorrecto en la vista: ${JSON.stringify(f)}`)
  }
})

prueba('la vista de movimientos expone quién lo registró, vía usuarios', async () => {
  const f = await unaFila(`select registrado_por from v_movimientos where documento_id = $1`, [ctx.guiaInterna])
  if (f.registrado_por !== 'Bodeguero Uno') {
    throw new Error(`v_movimientos.registrado_por debería salir de usuarios.nombre: quedó "${f.registrado_por}"`)
  }
})

prueba('una recepción con faltante genera un pendiente', async () => {
  // La entrada de los guantes fue 20 recibidos contra 24 de guía.
  const f = await unaFila(
    `select cantidad_faltante, pendiente, dias_abierto from v_pendientes where articulo_id = $1`,
    [ctx.guantes],
  )
  if (!f) throw new Error('El faltante de los guantes no aparece en v_pendientes')
  if (Number(f.cantidad_faltante) !== 4) throw new Error(`Faltante ${f.cantidad_faltante}, se esperaban 4`)
  if (f.pendiente !== true) throw new Error('Debería estar pendiente')
  ctx.lineaPendiente = (
    await unaFila(`select linea_id from v_pendientes where articulo_id = $1`, [ctx.guantes])
  ).linea_id
})

prueba('una recepción sin diferencia NO genera pendiente', async () => {
  // El cable entró 500 contra 500 de guía: no debe aparecer.
  const f = await unaFila(`select 1 as x from v_pendientes where articulo_id = $1`, [ctx.cable])
  if (f) throw new Error('Un artículo sin diferencia apareció como pendiente')
})

prueba('el rol Consulta no puede cerrar un pendiente', async () => {
  await debeFallar(
    () =>
      como(ctx.consulta, () =>
        db.query(
          `insert into resoluciones_pendiente (linea_id, motivo, resuelto_por) values ($1,'MERMA_ACEPTADA',$2)`,
          [ctx.lineaPendiente, ctx.consulta],
        ),
      ),
    'row-level security',
  )
})

prueba('cerrar un pendiente no toca el libro', async () => {
  const antes = await unaFila(`select cantidad, cantidad_guia from movimiento_lineas where id = $1`, [
    ctx.lineaPendiente,
  ])

  await como(ctx.bodeguero, () =>
    db.query(
      `insert into resoluciones_pendiente (linea_id, motivo, nota, resuelto_por)
       values ($1,'LLEGO_DESPUES','Llegaron en la guía 26600',$2)`,
      [ctx.lineaPendiente, ctx.bodeguero],
    ),
  )

  const f = await unaFila(`select pendiente, motivo, resuelto_por_nombre from v_pendientes where linea_id = $1`, [
    ctx.lineaPendiente,
  ])
  if (f.pendiente !== false) throw new Error('Sigue apareciendo como pendiente')
  if (f.motivo !== 'LLEGO_DESPUES') throw new Error(`Motivo ${f.motivo}`)

  const despues = await unaFila(`select cantidad, cantidad_guia from movimiento_lineas where id = $1`, [
    ctx.lineaPendiente,
  ])
  if (antes.cantidad !== despues.cantidad || antes.cantidad_guia !== despues.cantidad_guia) {
    throw new Error('Cerrar el pendiente modificó la línea del movimiento')
  }
})

prueba('CUADRATURA: la caché de stock coincide exactamente con la suma del libro', async () => {
  const { rows } = await db.query(`
    select coalesce(c.articulo_id, l.articulo_id) as articulo_id,
           coalesce(c.cantidad, 0) as cache,
           coalesce(l.cantidad, 0) as libro
      from stock_cache c
      full outer join v_stock_libro l
        on l.articulo_id = c.articulo_id and l.bodega_id = c.bodega_id
     where coalesce(c.cantidad, 0) <> coalesce(l.cantidad, 0)
  `)
  if (rows.length > 0) {
    throw new Error(`La caché no cuadra con el libro en ${rows.length} fila(s): ${JSON.stringify(rows)}`)
  }

  // Y recalcular desde cero no debe cambiar nada.
  const { rows: cambios } = await db.query(`select * from recalcular_stock()`)
  if (cambios.length > 0) {
    throw new Error(`Recalcular alteró ${cambios.length} saldo(s): ${JSON.stringify(cambios)}`)
  }
})

prueba('el stock bajo mínimo se detecta en ambos sentidos', async () => {
  // Sin números absolutos: la prueba compara contra el mínimo del propio artículo,
  // así que agregar movimientos más arriba no la rompe.
  const { rows } = await db.query(
    `select codigo_defontana, cantidad, stock_minimo, bajo_minimo
       from v_stock where bodega_id = $1 and codigo_defontana in ('EPP-GNT-01','CBL-4MM')`,
    [ctx.bodega],
  )
  for (const f of rows) {
    const esperado = Number(f.cantidad) < Number(f.stock_minimo)
    if (f.bajo_minimo !== esperado) {
      throw new Error(
        `${f.codigo_defontana}: cantidad ${f.cantidad} contra mínimo ${f.stock_minimo} debería dar bajo_minimo=${esperado}`,
      )
    }
  }

  // El caso positivo hay que provocarlo: con los movimientos de esta corrida
  // ningún artículo queda bajo su mínimo, y una prueba que solo comprueba el caso
  // negativo pasaría igual aunque la bandera estuviera siempre en false.
  await db.query(`update articulos set stock_minimo = 100000 where id = $1`, [ctx.cable])
  const critico = await unaFila(
    `select cantidad, stock_minimo, bajo_minimo from v_stock where articulo_id = $1 and bodega_id = $2`,
    [ctx.cable, ctx.bodega],
  )
  if (!critico.bajo_minimo) {
    throw new Error(`Con ${critico.cantidad} sobre un mínimo de ${critico.stock_minimo} debería marcarse crítico`)
  }
  await db.query(`update articulos set stock_minimo = 50 where id = $1`, [ctx.cable])
})

// --- v_stock: una fila por saldo que existe de verdad --------------------------
// Antes de la 0009 esta vista hacía `articulos CROSS JOIN bodegas`, así que abrir
// una bodega duplicaba el catálogo entero en la pantalla de Stock. Estas cinco
// pruebas son las cinco afirmaciones del modelo nuevo.

prueba('crear una bodega NO agrega ninguna fila al stock', async () => {
  const antes = await unaFila(`select count(*)::int as n from v_stock`)
  ctx.bodegaVacia = (
    await unaFila(`insert into bodegas (nombre) values ('Bodega Recién Abierta') returning id`)
  ).id
  const despues = await unaFila(`select count(*)::int as n from v_stock`)

  if (antes.n !== despues.n) {
    throw new Error(
      `Abrir una bodega pasó el stock de ${antes.n} a ${despues.n} fila(s): está duplicando el catálogo`,
    )
  }
})

prueba('un artículo sin movimientos no aparece en el stock, pero sí en el catálogo', async () => {
  const { id } = await unaFila(
    `insert into articulos (codigo_defontana, descripcion, tipo, unidad, stock_minimo)
     values ('MAT-NUNCA-01','Material que nunca llegó','MATERIAL','UN',5) returning id`,
  )

  const enStock = await unaFila(`select count(*)::int as n from v_stock where articulo_id = $1`, [id])
  if (enStock.n !== 0) {
    throw new Error(`Un artículo sin movimientos aparece en ${enStock.n} fila(s) de stock`)
  }

  // Sigue existiendo: el catálogo y el stock son dos cosas distintas.
  const enCatalogo = await unaFila(`select count(*)::int as n from articulos where id = $1`, [id])
  if (enCatalogo.n !== 1) throw new Error('El artículo desapareció del catálogo')
})

prueba('un artículo con saldo en dos bodegas muestra dos filas, no una duplicada', async () => {
  // El traslado de más arriba dejó cable en las dos bodegas.
  const { rows } = await db.query(
    `select bodega_id, cantidad from v_stock where articulo_id = $1 order by bodega_id`,
    [ctx.cable],
  )
  if (rows.length !== 2) {
    throw new Error(`El cable está en dos bodegas pero v_stock devuelve ${rows.length} fila(s)`)
  }

  // Y cada fila trae el saldo de SU bodega, no el total repetido.
  for (const f of rows) {
    const esperado = await saldo(ctx.cable, f.bodega_id)
    if (Number(f.cantidad) !== esperado) {
      throw new Error(`La bodega ${f.bodega_id} muestra ${f.cantidad} y su saldo real es ${esperado}`)
    }
  }
})

prueba('una bodega inactiva desaparece del stock sin perder sus movimientos', async () => {
  const antes = await unaFila(`select count(*)::int as n from v_stock where bodega_id = $1`, [ctx.bodegaFaena])
  if (antes.n === 0) throw new Error('La prueba no sirve: la bodega de faena no tiene stock que ocultar')

  await db.query(`update bodegas set activo = false where id = $1`, [ctx.bodegaFaena])
  const despues = await unaFila(`select count(*)::int as n from v_stock where bodega_id = $1`, [ctx.bodegaFaena])
  if (despues.n !== 0) throw new Error(`Una bodega inactiva sigue mostrando ${despues.n} fila(s) de stock`)

  // Ocultarla no borra nada: el libro es inmutable y el traslado sigue ahí.
  const movs = await unaFila(`select count(*)::int as n from movimientos where bodega_destino_id = $1`, [
    ctx.bodegaFaena,
  ])
  if (movs.n === 0) throw new Error('Desactivar la bodega se llevó sus movimientos por delante')

  await db.query(`update bodegas set activo = true where id = $1`, [ctx.bodegaFaena])
})

prueba('un artículo de tipo ACTIVO se recibe y se mueve como cualquier otro', async () => {
  ctx.silla = (
    await unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, unidad, stock_minimo)
       values ('ACT-SILLA-01','Silla ergonómica de oficina','ACTIVO','UN',2) returning id`,
    )
  ).id

  await como(ctx.bodeguero, () =>
    db.query(`select registrar_recepcion($1::jsonb) as r`, [
      JSON.stringify({
        documento: { folio: '26800', origen: 'TRASLADO_INTERNO', origen_nombre: 'Bodega Central Coquimbo' },
        bodega_id: ctx.bodega,
        lineas: [{ articulo_id: ctx.silla, cantidad: 6, cantidad_guia: 6 }],
      }),
    ]),
  )
  if ((await saldo(ctx.silla, ctx.bodega)) !== 6) throw new Error('La entrada del activo no sumó stock')

  // Sale a una sala igual que el material: un activo no necesita un séptimo tipo
  // de movimiento, solo una categoría propia.
  await mover(ctx.bodeguero, {
    tipo: 'SALIDA_SALA',
    bodega_id: ctx.bodega,
    sala_id: ctx.sala,
    retirado_por_id: ctx.trabajador,
    lineas: [{ articulo_id: ctx.silla, cantidad: 2 }],
  })

  const fila = await unaFila(`select tipo, cantidad from v_stock where articulo_id = $1 and bodega_id = $2`, [
    ctx.silla,
    ctx.bodega,
  ])
  if (fila.tipo !== 'ACTIVO') throw new Error(`El stock reporta el tipo "${fila.tipo}" en vez de ACTIVO`)
  if (Number(fila.cantidad) !== 4) throw new Error(`Se esperaban 4 sillas, hay ${fila.cantidad}`)
})

// --- la foto del artículo ------------------------------------------------------
// El bodeguero NO tiene UPDATE sobre `articulos` (política `admin_articulos`), y
// bajo RLS un UPDATE denegado no falla: afecta cero filas. Por eso la foto se
// escribe con `fijar_foto_articulo`, y estas pruebas comprueban que esa puerta no
// se abrió más de la cuenta.

const fijarFoto = (uid, articulo, foto, mini) =>
  como(uid, () =>
    db.query(`select fijar_foto_articulo($1::uuid, $2, $3) as a`, [articulo, foto, mini]),
  )

prueba('el bodeguero puede fijar la foto de un artículo, y la fila cambia de verdad', async () => {
  await fijarFoto(ctx.bodeguero, ctx.cable, 'cable/abc.webp', 'cable/abc_mini.webp')

  const a = await unaFila(`select foto_path, foto_miniatura_path from articulos where id = $1`, [ctx.cable])
  if (a.foto_path !== 'cable/abc.webp' || a.foto_miniatura_path !== 'cable/abc_mini.webp') {
    throw new Error(`La foto no quedó guardada: ${JSON.stringify(a)}`)
  }
})

prueba('fijar la foto NO le abre al bodeguero el resto del artículo', async () => {
  // El riesgo real de esta función: que para dejarlo poner una foto se le haya
  // dado UPDATE sobre la tabla, con el que podría cambiar el código o el mínimo
  // de un artículo que ya tiene movimientos.
  const antes = await unaFila(`select codigo_defontana, stock_minimo from articulos where id = $1`, [ctx.cable])

  const r = await como(ctx.bodeguero, () =>
    db.query(`update articulos set codigo_defontana = 'HACKEADO', stock_minimo = 99999 where id = $1`, [ctx.cable]),
  )
  if (r.affectedRows !== 0) throw new Error(`El bodeguero modificó ${r.affectedRows} artículo(s); no debería poder`)

  const despues = await unaFila(`select codigo_defontana, stock_minimo from articulos where id = $1`, [ctx.cable])
  if (antes.codigo_defontana !== despues.codigo_defontana || Number(antes.stock_minimo) !== Number(despues.stock_minimo)) {
    throw new Error('El artículo cambió pese a que el UPDATE no debía tener efecto')
  }
})

prueba('el rol Consulta no puede tocar la foto', async () => {
  await debeFallar(
    () => fijarFoto(ctx.consulta, ctx.cable, 'otra/foto.webp', 'otra/foto_mini.webp'),
    'no permite cambiar la foto',
  )
})

prueba('pasar null quita la foto', async () => {
  await fijarFoto(ctx.bodeguero, ctx.cable, null, null)
  const a = await unaFila(`select foto_path, foto_miniatura_path from articulos where id = $1`, [ctx.cable])
  if (a.foto_path !== null || a.foto_miniatura_path !== null) {
    throw new Error(`La foto no se quitó: ${JSON.stringify(a)}`)
  }

  // Y se puede volver a poner, para dejar el estado listo para la prueba de v_stock.
  await fijarFoto(ctx.bodeguero, ctx.cable, 'cable/def.webp', 'cable/def_mini.webp')
})

prueba('v_stock expone la miniatura sin perder ninguna columna anterior', async () => {
  const fila = await unaFila(`select * from v_stock where articulo_id = $1 and bodega_id = $2`, [
    ctx.cable,
    ctx.bodega,
  ])
  if (fila.foto_miniatura_path !== 'cable/def_mini.webp') {
    throw new Error(`v_stock no trae la miniatura: ${fila.foto_miniatura_path}`)
  }

  // La vista se recreó con CREATE OR REPLACE agregando columnas al final; si
  // alguien la reescribe con DROP y se salta una, esto lo detecta.
  for (const col of [
    'articulo_id', 'codigo_defontana', 'descripcion', 'tipo', 'unidad', 'marca', 'familia',
    'controla_serie', 'stock_minimo', 'activo', 'bodega_id', 'bodega', 'cantidad', 'bajo_minimo',
  ]) {
    if (!(col in fila)) throw new Error(`v_stock perdió la columna "${col}"`)
  }
})

// --- eliminar registros de catálogo --------------------------------------------
// El ADMIN ya podía hacer DELETE en estas 4 tablas a nivel de permisos (política
// `admin_X for all`); lo que faltaba era la interfaz. Estas pruebas comprueban
// las tres afirmaciones reales: sin historial se borra, con historial la llave
// foránea lo bloquea, y a otro rol el DELETE no le falla — le afecta cero filas.

prueba('ADMIN puede eliminar un registro sin historial de cada catálogo', async () => {
  const casosTabla = [
    { tabla: 'bodegas', insert: `insert into bodegas (nombre) values ('Bodega Para Borrar') returning id` },
    {
      tabla: 'articulos',
      insert: `insert into articulos (codigo_defontana, descripcion, tipo) values ('BORRAR-01','Para borrar','MATERIAL') returning id`,
    },
    { tabla: 'proveedores', insert: `insert into proveedores (nombre) values ('Proveedor Para Borrar') returning id` },
    {
      tabla: 'trabajadores',
      insert: `insert into trabajadores (rut, nombre) values ('9.999.999-9','Para Borrar') returning id`,
    },
  ]
  for (const { tabla, insert } of casosTabla) {
    const { id } = await unaFila(insert)
    const r = await como(ctx.admin, () => db.query(`delete from ${tabla} where id = $1`, [id]))
    if (r.affectedRows !== 1) throw new Error(`ADMIN no pudo eliminar de ${tabla}: affectedRows=${r.affectedRows}`)
    const queda = await unaFila(`select count(*)::int as n from ${tabla} where id = $1`, [id])
    if (queda.n !== 0) throw new Error(`El registro de ${tabla} sigue existiendo tras eliminarlo`)
  }
})

prueba('una llave foránea impide eliminar un registro de catálogo con historial', async () => {
  await debeFallar(() => como(ctx.admin, () => db.query(`delete from bodegas where id = $1`, [ctx.bodega])), 'foreign key')
  await debeFallar(() => como(ctx.admin, () => db.query(`delete from articulos where id = $1`, [ctx.cable])), 'foreign key')
  await debeFallar(
    () => como(ctx.admin, () => db.query(`delete from proveedores where id = $1`, [ctx.proveedor])),
    'foreign key',
  )
  await debeFallar(
    () => como(ctx.admin, () => db.query(`delete from trabajadores where id = $1`, [ctx.trabajador])),
    'foreign key',
  )
})

prueba('CONSULTA y BODEGUERO no pueden eliminar catálogos: el DELETE no falla, afecta cero filas', async () => {
  const { id: bodegaId } = await unaFila(`insert into bodegas (nombre) values ('Bodega RLS 1') returning id`)

  let r = await como(ctx.consulta, () => db.query(`delete from bodegas where id = $1`, [bodegaId]))
  if (r.affectedRows !== 0) throw new Error(`Consulta pudo eliminar una bodega: affectedRows=${r.affectedRows}`)
  let queda = await unaFila(`select count(*)::int as n from bodegas where id = $1`, [bodegaId])
  if (queda.n !== 1) throw new Error('La bodega desapareció pese a que Consulta no debía poder borrarla')

  r = await como(ctx.bodeguero, () => db.query(`delete from bodegas where id = $1`, [bodegaId]))
  if (r.affectedRows !== 0) throw new Error(`Bodeguero pudo eliminar una bodega: affectedRows=${r.affectedRows}`)
  queda = await unaFila(`select count(*)::int as n from bodegas where id = $1`, [bodegaId])
  if (queda.n !== 1) throw new Error('La bodega desapareció pese a que Bodeguero no debía poder borrarla')
})

// --- anular_movimiento: contramovimiento, nunca toca el original ---------------
// Fixtures propios (bodegas y artículos que nadie más toca) para no desincronizar
// los saldos exactos que otras pruebas más arriba ya dejaron cuadrados.

prueba('preparar fixtures propios para anular_movimiento', async () => {
  ctx.bodegaAnular = (await unaFila(`insert into bodegas (nombre) values ('Bodega Anulación') returning id`)).id
  ctx.bodegaAnularDestino = (
    await unaFila(`insert into bodegas (nombre) values ('Bodega Anulación Destino') returning id`)
  ).id
  // Esta sección origina todos sus movimientos en `ctx.bodegaAnular`, no en
  // `ctx.bodega` — reapunta la bodega elegida del bodeguero para esta parte.
  await db.query(`update usuarios set bodega_actual_id = $1 where id = $2`, [ctx.bodegaAnular, ctx.bodeguero])
  ctx.artAnular = (
    await unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, unidad)
       values ('ANU-MAT-01','Material para anular','MATERIAL','UN') returning id`,
    )
  ).id
  ctx.artAnularSerie = (
    await unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, controla_serie)
       values ('ANU-SER-01','Artículo con serie para anular','MATERIAL',true) returning id`,
    )
  ).id
  ctx.guiaAnular = (
    await como(ctx.bodeguero, () =>
      unaFila(
        `insert into bodega_documentos (tipo, folio, fecha, origen, creado_por)
         values ('GUIA_DESPACHO','ANU-001',current_date,'TRASLADO_INTERNO',$1) returning id`,
        [ctx.bodeguero],
      ),
    )
  ).id
  if (!ctx.bodegaAnular || !ctx.artAnular || !ctx.artAnularSerie || !ctx.guiaAnular) {
    throw new Error('No se pudieron crear los fixtures de anulación')
  }
})

prueba('anular una ENTRADA vuelve el saldo al valor previo, y el original queda intacto', async () => {
  const antes = await saldo(ctx.artAnular, ctx.bodegaAnular)
  const r = await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 50, cantidad_guia: 50 }],
  })
  const movId = r.rows[0].r.movimiento_id
  const despuesEntrada = await saldo(ctx.artAnular, ctx.bodegaAnular)
  if (despuesEntrada !== antes + 50) throw new Error(`La entrada no sumó 50: ${despuesEntrada}`)

  const originalAntes = await unaFila(`select tipo, bodega_id, anula_movimiento_id from movimientos where id = $1`, [
    movId,
  ])

  const { rows } = await anular(ctx.admin, movId, 'Se recibió por error')
  const anulacion = rows[0]
  ctx.movAnuladoEntrada = movId
  ctx.movAnulacionEntrada = anulacion.id

  const despuesAnular = await saldo(ctx.artAnular, ctx.bodegaAnular)
  if (despuesAnular !== antes) {
    throw new Error(`El saldo tras anular debería volver a ${antes}, quedó en ${despuesAnular}`)
  }

  const originalDespues = await unaFila(`select tipo, bodega_id, anula_movimiento_id from movimientos where id = $1`, [
    movId,
  ])
  if (JSON.stringify(originalAntes) !== JSON.stringify(originalDespues)) {
    throw new Error('El movimiento original cambió tras anularlo')
  }

  const nueva = await unaFila(`select tipo, anula_movimiento_id from movimientos where id = $1`, [anulacion.id])
  if (nueva.tipo !== 'AJUSTE') throw new Error(`La anulación de una ENTRADA debería ser un AJUSTE, fue ${nueva.tipo}`)
  if (nueva.anula_movimiento_id !== movId) throw new Error('La anulación no quedó enlazada al original')
})

prueba('anular una ENTRADA con serie deja la serie en BAJA, sin borrarla', async () => {
  const r = await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnularSerie, cantidad: 1, series: ['ANU-SN-01'] }],
  })
  const movId = r.rows[0].r.movimiento_id

  await anular(ctx.admin, movId, 'Serie ingresada por error')

  const s = await unaFila(
    `select estado from series where articulo_id = $1 and numero_serie = 'ANU-SN-01'`,
    [ctx.artAnularSerie],
  )
  if (!s) throw new Error('La serie desapareció al anular la entrada; debe seguir existiendo')
  if (s.estado !== 'BAJA') throw new Error(`La serie debería quedar BAJA, quedó ${s.estado}`)
})

prueba('anular una SALIDA_SALA con serie la devuelve disponible a la bodega', async () => {
  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnularSerie, cantidad: 1, series: ['ANU-SN-02'] }],
  })
  const salida = await mover(ctx.bodeguero, {
    tipo: 'SALIDA_SALA',
    bodega_id: ctx.bodegaAnular,
    sala_id: ctx.sala,
    lineas: [{ articulo_id: ctx.artAnularSerie, cantidad: 1, series: ['ANU-SN-02'] }],
  })
  const movSalidaId = salida.rows[0].r.movimiento_id
  const antesSaldo = await saldo(ctx.artAnularSerie, ctx.bodegaAnular)

  await anular(ctx.admin, movSalidaId, 'La sala no la necesitaba')

  const despuesSaldo = await saldo(ctx.artAnularSerie, ctx.bodegaAnular)
  if (despuesSaldo !== antesSaldo + 1) {
    throw new Error(`El saldo no volvió a subir tras anular la salida: ${despuesSaldo}`)
  }

  // La anulación de una salida usa DEVOLUCION, que deja la serie DEVUELTO — no
  // EN_BODEGA. Es el mismo estado que una devolución real desde terreno, y
  // ambos cuentan como disponible (`v_series_disponibles`).
  const s = await unaFila(
    `select estado, bodega_id from series where articulo_id = $1 and numero_serie = 'ANU-SN-02'`,
    [ctx.artAnularSerie],
  )
  if (!['EN_BODEGA', 'DEVUELTO'].includes(s.estado)) {
    throw new Error(`La serie debería quedar disponible (EN_BODEGA o DEVUELTO), quedó ${s.estado}`)
  }
  if (s.bodega_id !== ctx.bodegaAnular) throw new Error('La serie no volvió a la bodega correcta')
})

prueba('anular un TRASLADO vuelve el saldo de ambas bodegas al valor previo', async () => {
  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 30, cantidad_guia: 30 }],
  })
  const antesOrigen = await saldo(ctx.artAnular, ctx.bodegaAnular)
  const antesDestino = await saldo(ctx.artAnular, ctx.bodegaAnularDestino)

  const traslado = await mover(ctx.bodeguero, {
    tipo: 'TRASLADO',
    bodega_id: ctx.bodegaAnular,
    bodega_destino_id: ctx.bodegaAnularDestino,
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 10 }],
  })
  const movTrasladoId = traslado.rows[0].r.movimiento_id

  await anular(ctx.admin, movTrasladoId, 'Traslado equivocado de bodega')

  const despuesOrigen = await saldo(ctx.artAnular, ctx.bodegaAnular)
  const despuesDestino = await saldo(ctx.artAnular, ctx.bodegaAnularDestino)
  if (despuesOrigen !== antesOrigen) throw new Error(`Origen: se esperaba ${antesOrigen}, quedó ${despuesOrigen}`)
  if (despuesDestino !== antesDestino) throw new Error(`Destino: se esperaba ${antesDestino}, quedó ${despuesDestino}`)
})

prueba('anular un AJUSTE positivo con serie deja la serie en BAJA', async () => {
  const ajuste = await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodegaAnular,
    motivo: 'Se encontró en inventario físico',
    lineas: [{ articulo_id: ctx.artAnularSerie, cantidad: 1, series: ['ANU-SN-03'] }],
  })
  const movAjusteId = ajuste.rows[0].r.movimiento_id

  await anular(ctx.admin, movAjusteId, 'El hallazgo fue un error de conteo')

  const s = await unaFila(
    `select estado from series where articulo_id = $1 and numero_serie = 'ANU-SN-03'`,
    [ctx.artAnularSerie],
  )
  if (s.estado !== 'BAJA') throw new Error(`La serie debería quedar BAJA, quedó ${s.estado}`)
})

prueba('anular un AJUSTE negativo que dio de baja una serie la reactiva', async () => {
  // El parche de `_registrar_movimiento_interno`: sin él, este AJUSTE positivo
  // de reversa chocaría con "la serie ya está registrada" en vez de reactivarla.
  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnularSerie, cantidad: 1, series: ['ANU-SN-04'] }],
  })
  const ajusteBaja = await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodegaAnular,
    motivo: 'Se dio de baja por daño',
    lineas: [{ articulo_id: ctx.artAnularSerie, cantidad: -1, series: ['ANU-SN-04'] }],
  })
  const movAjusteBajaId = ajusteBaja.rows[0].r.movimiento_id

  const antesBaja = await unaFila(
    `select estado from series where articulo_id = $1 and numero_serie = 'ANU-SN-04'`,
    [ctx.artAnularSerie],
  )
  if (antesBaja.estado !== 'BAJA') {
    throw new Error(`La prueba no sirve: la serie no quedó BAJA, quedó ${antesBaja.estado}`)
  }

  await anular(ctx.admin, movAjusteBajaId, 'El daño no era real')

  const despues = await unaFila(
    `select estado, bodega_id from series where articulo_id = $1 and numero_serie = 'ANU-SN-04'`,
    [ctx.artAnularSerie],
  )
  if (despues.estado !== 'EN_BODEGA') throw new Error(`La serie debería reactivarse a EN_BODEGA, quedó ${despues.estado}`)
  if (despues.bodega_id !== ctx.bodegaAnular) throw new Error('La serie reactivada no quedó en la bodega correcta')
})

prueba('anular el mismo movimiento dos veces falla la segunda vez', async () => {
  await debeFallar(() => anular(ctx.admin, ctx.movAnuladoEntrada, 'Otra vez'), 'ya fue anulado')
})

prueba('anular sin motivo se rechaza', async () => {
  const r = await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 5, cantidad_guia: 5 }],
  })
  const movId = r.rows[0].r.movimiento_id
  await debeFallar(() => anular(ctx.admin, movId, ''), 'motivo')
  await debeFallar(() => anular(ctx.admin, movId, '   '), 'motivo')
})

prueba('anular una anulación se rechaza', async () => {
  await debeFallar(() => anular(ctx.admin, ctx.movAnulacionEntrada, 'Intento de anular la anulación'), 'anulación')
})

prueba('solo un Administrador puede anular movimientos', async () => {
  const r = await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 3, cantidad_guia: 3 }],
  })
  const movId = r.rows[0].r.movimiento_id
  await debeFallar(() => anular(ctx.bodeguero, movId, 'Intento sin ser admin'), 'Administrador')
  await debeFallar(() => anular(ctx.consulta, movId, 'Intento sin ser admin'), 'Administrador')
})

// --- bodega obligatoria por sesión ---------------------------------------------
// `usuarios.bodega_actual_id` (agregada en 0020, gobernada por 0012) manda en
// qué bodega puede ORIGINAR un movimiento un Bodeguero o Prevencionista.
// Administrador queda exento a propósito: necesita poder anular o ajustar en
// cualquier bodega.

prueba('fijar_bodega_actual rechaza una bodega inexistente o inactiva, y guarda una activa', async () => {
  await debeFallar(
    () => fijarBodegaActual(ctx.bodeguero, '00000000-0000-0000-0000-000000000000'),
    'no existe',
  )

  const { id: bodegaInactiva } = await unaFila(
    `insert into bodegas (nombre, activo) values ('Bodega Inactiva Test', false) returning id`,
  )
  await debeFallar(() => fijarBodegaActual(ctx.bodeguero, bodegaInactiva), 'no existe')

  ctx.bodegaX = (await unaFila(`insert into bodegas (nombre) values ('Bodega Sesión X') returning id`)).id
  ctx.bodegaY = (await unaFila(`insert into bodegas (nombre) values ('Bodega Sesión Y') returning id`)).id

  const { rows } = await fijarBodegaActual(ctx.bodeguero, ctx.bodegaX)
  if (rows[0].bodega_actual_id !== ctx.bodegaX) throw new Error('fijar_bodega_actual no guardó la elección')
})

prueba('un Bodeguero sin bodega elegida no puede registrar', async () => {
  const nuevoBodeguero = await crearUsuarioUnificadorQR('bodeguero2@wilug.cl', 'Bodeguero Dos')
  await fijarRolBodega(ctx.admin, nuevoBodeguero, 'BODEGUERO')

  await debeFallar(
    () =>
      mover(nuevoBodeguero, {
        tipo: 'SALIDA_SALA',
        bodega_id: ctx.bodegaX,
        sala_id: ctx.sala,
        lineas: [{ articulo_id: ctx.artAnular, cantidad: 1 }],
      }),
    'todavía no elegiste una bodega',
  )
})

prueba('un Bodeguero con bodega elegida no puede registrar en otra bodega', async () => {
  await debeFallar(
    () =>
      mover(ctx.bodeguero, {
        tipo: 'SALIDA_SALA',
        bodega_id: ctx.bodegaY,
        sala_id: ctx.sala,
        lineas: [{ articulo_id: ctx.artAnular, cantidad: 1 }],
      }),
    'solo puedes registrar movimientos en tu bodega elegida',
  )
})

prueba('un Bodeguero SÍ puede trasladar desde su bodega hacia otra distinta', async () => {
  // ctx.bodeguero tiene ctx.bodegaX elegida desde la prueba anterior.
  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaX,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 20, cantidad_guia: 20 }],
  })
  await mover(ctx.bodeguero, {
    tipo: 'TRASLADO',
    bodega_id: ctx.bodegaX,
    bodega_destino_id: ctx.bodegaY,
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 5 }],
  })
  const y = await saldo(ctx.artAnular, ctx.bodegaY)
  if (y < 5) throw new Error(`El traslado no llegó a la bodega destino: ${y}`)
})

prueba('un Prevencionista sin bodega elegida, o con una distinta, no puede entregar EPP', async () => {
  await db.query(`update usuarios set bodega_actual_id = null where id = $1`, [ctx.prevencionista])
  await debeFallar(
    () =>
      mover(ctx.prevencionista, {
        tipo: 'ENTREGA_EPP',
        bodega_id: ctx.bodegaX,
        trabajador_id: ctx.trabajador,
        lineas: [{ articulo_id: ctx.guantes, cantidad: 1 }],
      }),
    'todavía no elegiste una bodega',
  )

  await db.query(`update usuarios set bodega_actual_id = $1 where id = $2`, [ctx.bodegaY, ctx.prevencionista])
  await debeFallar(
    () =>
      mover(ctx.prevencionista, {
        tipo: 'ENTREGA_EPP',
        bodega_id: ctx.bodegaX,
        trabajador_id: ctx.trabajador,
        lineas: [{ articulo_id: ctx.guantes, cantidad: 1 }],
      }),
    'solo puedes registrar movimientos en tu bodega elegida',
  )

  // Se restaura para no dejar un residuo raro si algo más se agrega después.
  await db.query(`update usuarios set bodega_actual_id = $1 where id = $2`, [ctx.bodega, ctx.prevencionista])
})

prueba('un Administrador registra en cualquier bodega, sin importar la que tenga elegida (o ninguna)', async () => {
  const filaAdmin = await unaFila(`select bodega_actual_id from usuarios where id = $1`, [ctx.admin])
  if (filaAdmin.bodega_actual_id !== null) {
    throw new Error('La prueba asume que el Administrador nunca fijó una bodega en esta corrida')
  }

  await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodegaX,
    motivo: 'Ajuste de prueba del Administrador',
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 3 }],
  })
  const x = await saldo(ctx.artAnular, ctx.bodegaX)
  if (x <= 0) throw new Error('El ajuste del Administrador no se aplicó')
})

// --- equivalencias proveedor → código Defontana --------------------------------
// `equivalencias_proveedor` (0013) es solo una ayuda de búsqueda para la
// Recepción: no toca stock ni el libro de movimientos, así que estas pruebas no
// dependen de bodega ni de saldo.

prueba('registrar_equivalencia_proveedor enseña una equivalencia y normaliza el código', async () => {
  const { rows } = await como(ctx.bodeguero, () =>
    db.query(`select * from registrar_equivalencia_proveedor($1::uuid, $2, $3, $4::uuid)`, [
      ctx.proveedor,
      '  abc-123 ',
      'Cable rojo 4mm del proveedor',
      ctx.cable,
    ]),
  )
  if (rows[0].codigo_proveedor !== 'ABC-123') {
    throw new Error(`El código de proveedor no se normalizó: quedó "${rows[0].codigo_proveedor}"`)
  }
  if (rows[0].articulo_id !== ctx.cable) throw new Error('La equivalencia no quedó apuntando al artículo correcto')
})

prueba('la equivalencia se encuentra por proveedor+código normalizado, sin importar mayúsculas ni espacios', async () => {
  const { rows } = await como(ctx.bodeguero, () =>
    db.query(`select * from equivalencias_proveedor where proveedor_id = $1 and codigo_proveedor = $2`, [
      ctx.proveedor,
      ' Abc-123'.trim().toUpperCase(),
    ]),
  )
  if (rows.length !== 1) throw new Error(`Se esperaba encontrar 1 equivalencia, se encontraron ${rows.length}`)
})

prueba('registrar_equivalencia_proveedor corrige (upsert) en vez de duplicar', async () => {
  const antes = await unaFila(`select count(*)::int as n from equivalencias_proveedor where proveedor_id = $1`, [ctx.proveedor])

  const { rows } = await como(ctx.bodeguero, () =>
    db.query(`select * from registrar_equivalencia_proveedor($1::uuid, $2, $3, $4::uuid)`, [
      ctx.proveedor,
      'abc-123',
      'En realidad es el panel',
      ctx.panel,
    ]),
  )
  if (rows[0].articulo_id !== ctx.panel) throw new Error('La corrección no actualizó el artículo')

  const despues = await unaFila(`select count(*)::int as n from equivalencias_proveedor where proveedor_id = $1`, [ctx.proveedor])
  if (despues.n !== antes.n) throw new Error('El upsert duplicó la fila en vez de corregirla')
})

prueba('registrar_equivalencia_proveedor rechaza un proveedor o un artículo inexistente', async () => {
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(`select * from registrar_equivalencia_proveedor($1::uuid, $2, $3, $4::uuid)`, [
          '00000000-0000-0000-0000-000000000000',
          'XYZ-1',
          null,
          ctx.cable,
        ]),
      ),
    'proveedor no existe',
  )
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(`select * from registrar_equivalencia_proveedor($1::uuid, $2, $3, $4::uuid)`, [
          ctx.proveedor,
          'XYZ-1',
          null,
          '00000000-0000-0000-0000-000000000000',
        ]),
      ),
    'artículo no existe',
  )
})

prueba('un authenticated no puede insertar directo en equivalencias_proveedor: solo por la función', async () => {
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(
          `insert into equivalencias_proveedor (proveedor_id, codigo_proveedor, articulo_id) values ($1, 'DIRECTO-1', $2)`,
          [ctx.proveedor, ctx.cable],
        ),
      ),
    'row-level security',
  )
})

// --- tipos de artículo creables por el usuario ----------------------------------
// `tipos_articulo` (0015) reemplaza el enum fijo `tipo_articulo`. `EPP` sigue
// siendo el único con comportamiento real (Epp.tsx filtra tipo='EPP'); un tipo
// nuevo se comporta siempre como Material.

prueba('tipos_articulo trae los tres sembrados, con el código ya normalizado', async () => {
  const { rows } = await db.query(`select codigo, nombre from tipos_articulo order by codigo`)
  const codigos = rows.map((r) => r.codigo)
  for (const esperado of ['ACTIVO', 'EPP', 'MATERIAL']) {
    if (!codigos.includes(esperado)) throw new Error(`Falta el tipo sembrado ${esperado}`)
  }
})

prueba('un Bodeguero puede crear un tipo de artículo nuevo; Consulta no puede', async () => {
  const { rows } = await como(ctx.bodeguero, () =>
    db.query(`insert into tipos_articulo (nombre, color) values ($1, $2) returning *`, [
      ' Herramienta menor ',
      'bg-blue-100 text-blue-800',
    ]),
  )
  if (rows[0].codigo !== 'HERRAMIENTA MENOR') {
    throw new Error(`El código del tipo no se normalizó: quedó "${rows[0].codigo}"`)
  }
  ctx.tipoHerramienta = rows[0].codigo

  await debeFallar(
    () =>
      como(ctx.consulta, () =>
        db.query(`insert into tipos_articulo (nombre, color) values ($1, $2)`, ['Otro tipo', 'bg-rose-100 text-rose-800']),
      ),
    'row-level security',
  )
})

prueba('un artículo con un tipo recién creado se mueve como cualquier otro', async () => {
  ctx.taladro = (
    await unaFila(
      `insert into articulos (codigo_defontana, descripcion, tipo, unidad)
       values ('HTA-001','Taladro percutor', $1, 'UN') returning id`,
      [ctx.tipoHerramienta],
    )
  ).id

  // ctx.bodeguero tiene ctx.bodegaX elegida desde la sección de bodega por sesión.
  await mover(ctx.bodeguero, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaX,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.taladro, cantidad: 3, cantidad_guia: 3 }],
  })
  if ((await saldo(ctx.taladro, ctx.bodegaX)) !== 3) throw new Error('La entrada de un artículo con tipo nuevo no sumó stock')
})

prueba('una llave foránea impide borrar un tipo de artículo con artículos', async () => {
  await debeFallar(
    () => como(ctx.admin, () => db.query(`delete from tipos_articulo where codigo = $1`, [ctx.tipoHerramienta])),
    'foreign key',
  )
})

// --- formato de RUT --------------------------------------------------------
// `formatear_rut` (0016) normaliza a "00.000.000-0" vía trigger, tanto en
// proveedores como en trabajadores, sin validar el dígito verificador.

prueba('un RUT sin puntos ni guión queda formateado al guardar un trabajador', async () => {
  const { rut } = await unaFila(
    `insert into trabajadores (rut, nombre) values ('123456789', 'RUT Sin Formato') returning rut`,
  )
  if (rut !== '12.345.678-9') throw new Error(`Se esperaba "12.345.678-9", quedó "${rut}"`)
})

prueba('la k en minúscula del dígito verificador queda en mayúscula', async () => {
  const { rut } = await unaFila(
    `insert into proveedores (rut, nombre) values ('12345678k', 'Proveedor Con K') returning rut`,
  )
  if (rut !== '12.345.678-K') throw new Error(`Se esperaba "12.345.678-K", quedó "${rut}"`)
})

prueba('un RUT ya bien formateado no cambia (idempotencia)', async () => {
  const { rut } = await unaFila(
    `insert into proveedores (rut, nombre) values ('9.876.543-2', 'Proveedor Ya Formateado') returning rut`,
  )
  if (rut !== '9.876.543-2') throw new Error(`Se esperaba "9.876.543-2", quedó "${rut}"`)
})

// --- traslado real desde Recepción + agregar líneas a una recepción ya guardada ----
// 0017: "Traslado interno" con una bodega de origen real registra un TRASLADO de
// verdad (descuenta origen, acredita destino) en vez de un ENTRADA cosmético.
// `agregar_lineas_recepcion` suma líneas a un movimiento ya guardado, bajo el
// mismo folio — excepción acotada a que el libro es de solo inserción.

prueba('un traslado interno con bodega de origen registra un TRASLADO real: descuenta origen, acredita destino', async () => {
  // Se prepara stock en ctx.bodegaY para poder despacharlo desde ahí.
  await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodegaY,
    motivo: 'Preparar stock para probar el traslado desde Recepción',
    lineas: [{ articulo_id: ctx.cable, cantidad: 50 }],
  })
  const origenAntes = await saldo(ctx.cable, ctx.bodegaY)
  const destinoAntes = await saldo(ctx.cable, ctx.bodegaX)

  // ctx.bodeguero tiene ctx.bodegaX elegida — es quien recibe (el destino).
  const { rows } = await como(ctx.bodeguero, () =>
    db.query(`select registrar_recepcion($1::jsonb) as r`, [
      JSON.stringify({
        documento: { folio: 'TRASL-001', origen: 'TRASLADO_INTERNO', origen_bodega_id: ctx.bodegaY },
        bodega_id: ctx.bodegaX,
        lineas: [{ articulo_id: ctx.cable, cantidad: 10, cantidad_guia: 10 }],
      }),
    ]),
  )
  if (!rows[0].r.movimiento_id) throw new Error('El traslado desde Recepción no devolvió el movimiento')
  ctx.movTrasladoRecepcion = rows[0].r.movimiento_id

  const origenDespues = await saldo(ctx.cable, ctx.bodegaY)
  const destinoDespues = await saldo(ctx.cable, ctx.bodegaX)
  if (origenDespues !== origenAntes - 10) throw new Error(`No se descontó el origen: ${origenAntes} → ${origenDespues}`)
  if (destinoDespues !== destinoAntes + 10) throw new Error(`No se acreditó el destino: ${destinoAntes} → ${destinoDespues}`)

  const doc = await unaFila(
    `select d.origen_bodega_id, d.origen_nombre, m.tipo
       from movimientos m join bodega_documentos d on d.id = m.documento_id
      where m.id = $1`,
    [ctx.movTrasladoRecepcion],
  )
  if (doc.tipo !== 'TRASLADO') throw new Error(`Se esperaba tipo TRASLADO, quedó ${doc.tipo}`)
  if (doc.origen_bodega_id !== ctx.bodegaY) throw new Error('bodega_documentos.origen_bodega_id no quedó guardado')
  if (doc.origen_nombre !== 'Bodega Sesión Y') throw new Error(`origen_nombre no se llenó solo: quedó "${doc.origen_nombre}"`)
})

prueba('un Bodeguero cuya bodega de sesión no es el destino no puede recibir un traslado así', async () => {
  // ctx.bodeguero sigue con ctx.bodegaX elegida; se intenta recibir en ctx.bodega (otra distinta).
  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(`select registrar_recepcion($1::jsonb) as r`, [
          JSON.stringify({
            documento: { folio: 'TRASL-002', origen: 'TRASLADO_INTERNO', origen_bodega_id: ctx.bodegaY },
            bodega_id: ctx.bodega,
            lineas: [{ articulo_id: ctx.cable, cantidad: 1, cantidad_guia: 1 }],
          }),
        ]),
      ),
    'tu bodega elegida',
  )
})

prueba('agregar_lineas_recepcion suma líneas al mismo movimiento, sin crear uno nuevo', async () => {
  const { rows } = await como(ctx.bodeguero, () =>
    db.query(`select registrar_recepcion($1::jsonb) as r`, [
      JSON.stringify({
        documento: { folio: 'AGR-001', origen: 'COMPRA_EXTERNA', proveedor_id: ctx.proveedor },
        bodega_id: ctx.bodegaX,
        lineas: [{ articulo_id: ctx.cable, cantidad: 5, cantidad_guia: 5 }],
      }),
    ]),
  )
  const movId = rows[0].r.movimiento_id
  const folioOriginal = rows[0].r.folio
  const saldoAntes = await saldo(ctx.cable, ctx.bodegaX)

  const r2 = await como(ctx.bodeguero, () =>
    db.query(`select agregar_lineas_recepcion($1::uuid, $2::jsonb) as r`, [
      movId,
      JSON.stringify([{ articulo_id: ctx.cable, cantidad: 3, cantidad_guia: 3 }]),
    ]),
  )
  if (r2.rows[0].r.movimiento_id !== movId) throw new Error('agregar_lineas_recepcion no reusó el mismo movimiento')
  if (r2.rows[0].r.folio !== folioOriginal) throw new Error('El folio del movimiento cambió al agregar líneas')

  const saldoDespues = await saldo(ctx.cable, ctx.bodegaX)
  if (saldoDespues !== saldoAntes + 3) throw new Error(`No sumó stock: ${saldoAntes} → ${saldoDespues}`)

  const nLineas = await unaFila(`select count(*)::int as n from movimiento_lineas where movimiento_id = $1`, [movId])
  if (nLineas.n !== 2) throw new Error(`Se esperaban 2 líneas en el mismo movimiento, hay ${nLineas.n}`)

  const mov = await unaFila(`select editado_en, editado_por from movimientos where id = $1`, [movId])
  if (mov.editado_en === null || mov.editado_por !== ctx.bodeguero) {
    throw new Error('editado_en/editado_por no quedaron seteados')
  }
})

prueba('agregar_lineas_recepcion rechaza sobre un movimiento que no es una recepción con guía', async () => {
  const salida = await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodegaX,
    motivo: 'Fixture para probar el rechazo de agregar_lineas_recepcion',
    lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
  })
  await debeFallar(
    () =>
      como(ctx.admin, () =>
        db.query(`select agregar_lineas_recepcion($1::uuid, $2::jsonb) as r`, [
          salida.rows[0].r.movimiento_id,
          JSON.stringify([{ articulo_id: ctx.cable, cantidad: 1 }]),
        ]),
      ),
    'entrada o traslado interno',
  )
})

prueba('agregar_lineas_recepcion rechaza sobre una recepción ya anulada', async () => {
  const { rows } = await como(ctx.bodeguero, () =>
    db.query(`select registrar_recepcion($1::jsonb) as r`, [
      JSON.stringify({
        documento: { folio: 'AGR-002', origen: 'COMPRA_EXTERNA', proveedor_id: ctx.proveedor },
        bodega_id: ctx.bodegaX,
        lineas: [{ articulo_id: ctx.cable, cantidad: 2, cantidad_guia: 2 }],
      }),
    ]),
  )
  const movId = rows[0].r.movimiento_id
  await anular(ctx.admin, movId, 'Anulación de prueba para agregar_lineas_recepcion')

  await debeFallar(
    () =>
      como(ctx.bodeguero, () =>
        db.query(`select agregar_lineas_recepcion($1::uuid, $2::jsonb) as r`, [
          movId,
          JSON.stringify([{ articulo_id: ctx.cable, cantidad: 1 }]),
        ]),
      ),
    'ya fue anulada',
  )
})

// --- eliminar_movimiento (0018) -------------------------------------------
// Reemplaza a Anular en el menú de Movimientos: borra de verdad, sin rastro.
// Acotado a Administrador, a movimientos sin cadena de anulación, y sin
// artículos de número de serie.

prueba('un ADMIN elimina un movimiento simple y el saldo vuelve al valor previo', async () => {
  const antes = await saldo(ctx.artAnular, ctx.bodegaAnular)
  const r = await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodegaAnular,
    motivo: 'Fixture para probar eliminar_movimiento',
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 7 }],
  })
  const movId = r.rows[0].r.movimiento_id
  const conMovimiento = await saldo(ctx.artAnular, ctx.bodegaAnular)
  if (conMovimiento !== antes + 7) throw new Error('El ajuste de prueba no sumó lo esperado')

  await como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [movId]))

  const despues = await saldo(ctx.artAnular, ctx.bodegaAnular)
  if (despues !== antes) throw new Error(`El saldo no volvió al valor previo: esperado ${antes}, quedó ${despues}`)

  const existe = await unaFila(`select count(*)::int as n from movimientos where id = $1`, [movId])
  if (existe.n !== 0) throw new Error('El movimiento sigue existiendo después de eliminarlo')

  const { rows: cambios } = await db.query(`select * from recalcular_stock()`)
  if (cambios.length > 0) throw new Error(`Quedó una diferencia tras eliminar: ${JSON.stringify(cambios)}`)
})

prueba('eliminar_movimiento rechaza sobre un movimiento ya anulado', async () => {
  await debeFallar(
    () => como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [ctx.movAnuladoEntrada])),
    'ya fue anulado',
  )
})

prueba('eliminar_movimiento rechaza sobre una anulación', async () => {
  await debeFallar(
    () => como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [ctx.movAnulacionEntrada])),
    'anulación',
  )
})

prueba('eliminar_movimiento rechaza sobre un movimiento con artículos de número de serie', async () => {
  const r = await mover(ctx.admin, {
    tipo: 'ENTRADA',
    bodega_id: ctx.bodegaAnular,
    documento_id: ctx.guiaAnular,
    lineas: [{ articulo_id: ctx.artAnularSerie, cantidad: 1, series: ['ELIM-SN-01'] }],
  })
  await debeFallar(
    () => como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [r.rows[0].r.movimiento_id])),
    'número de serie',
  )
})

prueba('eliminar_movimiento rechaza para quien no es Administrador', async () => {
  const r = await mover(ctx.admin, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodegaAnular,
    motivo: 'Fixture para probar el rechazo por rol',
    lineas: [{ articulo_id: ctx.artAnular, cantidad: 1 }],
  })
  await debeFallar(
    () => como(ctx.bodeguero, () => db.query(`select eliminar_movimiento($1::uuid)`, [r.rows[0].r.movimiento_id])),
    'Administrador',
  )
})

// --- 0019: correcciones a eliminar_movimiento -----------------------------
// Encontradas al usar la función en la práctica: la guía huérfana bloqueaba
// volver a recibirla, y un artículo con equivalencia enseñada no se podía
// eliminar aunque ya no tuviera ningún movimiento.

prueba('eliminar_movimiento borra la guía huérfana: se puede volver a recibir el mismo folio', async () => {
  const folio = 'ELIM-DOC-01'
  const recepcion = () =>
    como(ctx.bodeguero, () =>
      db.query(`select registrar_recepcion($1::jsonb) as r`, [
        JSON.stringify({
          documento: { folio, origen: 'COMPRA_EXTERNA', proveedor_id: ctx.proveedor },
          bodega_id: ctx.bodegaX,
          lineas: [{ articulo_id: ctx.cable, cantidad: 1, cantidad_guia: 1 }],
        }),
      ]),
    )

  const primera = await recepcion()
  const movId = primera.rows[0].r.movimiento_id

  await debeFallar(recepcion, 'bodega_documentos_folio_uq')

  await como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [movId]))

  // Antes de esta corrección, esto seguía fallando: el `bodega_documentos`
  // huérfano chocaba con `bodega_documentos_folio_uq` aunque su movimiento ya
  // no existiera.
  const segunda = await recepcion()
  if (!segunda.rows[0].r.movimiento_id) throw new Error('No se pudo volver a recibir la misma guía tras eliminar el movimiento')

  await como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [segunda.rows[0].r.movimiento_id]))
})

prueba('eliminar_movimiento no borra la guía si otro movimiento todavía la usa', async () => {
  const { id: docId } = await unaFila(
    `insert into bodega_documentos (tipo, folio, proveedor_id, fecha, creado_por)
     values ('GUIA_DESPACHO','ELIM-DOC-02',$1,current_date,$2) returning id`,
    [ctx.proveedor, ctx.bodeguero],
  )
  const a = await mover(ctx.admin, { tipo: 'ENTRADA', bodega_id: ctx.bodegaX, documento_id: docId, lineas: [{ articulo_id: ctx.cable, cantidad: 1 }] })
  const b = await mover(ctx.admin, { tipo: 'ENTRADA', bodega_id: ctx.bodegaX, documento_id: docId, lineas: [{ articulo_id: ctx.cable, cantidad: 1 }] })

  await como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [a.rows[0].r.movimiento_id]))
  const tras1a = await unaFila(`select count(*)::int as n from bodega_documentos where id = $1`, [docId])
  if (tras1a.n !== 1) throw new Error('La guía se borró aunque otro movimiento todavía la usaba')

  await como(ctx.admin, () => db.query(`select eliminar_movimiento($1::uuid)`, [b.rows[0].r.movimiento_id]))
  const tras2a = await unaFila(`select count(*)::int as n from bodega_documentos where id = $1`, [docId])
  if (tras2a.n !== 0) throw new Error('La guía siguió existiendo después de eliminar su último movimiento')
})

prueba('eliminar un artículo cuya equivalencia de proveedor fue enseñada ahora funciona (cascade)', async () => {
  const { id: articuloId } = await unaFila(
    `insert into articulos (codigo_defontana, descripcion, tipo) values ('ELIM-EQ-01','Para borrar con equivalencia','MATERIAL') returning id`,
  )
  await como(ctx.bodeguero, () =>
    db.query(`select * from registrar_equivalencia_proveedor($1::uuid, $2, $3, $4::uuid)`, [
      ctx.proveedor,
      'ELIM-EQ-PROV-01',
      'Como lo llama el proveedor',
      articuloId,
    ]),
  )

  // Antes de la migración 0019, esto fallaba con una llave foránea: la fila de
  // equivalencias_proveedor seguía apuntando al artículo.
  const r = await como(ctx.admin, () => db.query(`delete from articulos where id = $1`, [articuloId]))
  if (r.affectedRows !== 1) throw new Error(`No se pudo eliminar el artículo: affectedRows=${r.affectedRows}`)

  const queda = await unaFila(`select count(*)::int as n from equivalencias_proveedor where articulo_id = $1`, [articuloId])
  if (queda.n !== 0) throw new Error('La equivalencia sobrevivió al artículo que borró en cascada')
})

prueba('CUADRATURA: la caché sigue coincidiendo con el libro tras eliminar y anular', async () => {
  const { rows: cambios } = await db.query(`select * from recalcular_stock()`)
  if (cambios.length > 0) {
    throw new Error(`Recalcular alteró ${cambios.length} saldo(s): ${JSON.stringify(cambios)}`)
  }
})

// =================================================================================
// --- FUSIÓN DE ROLES CON UNIFICADOR-QR (Fase 0) -----------------------------------
// =================================================================================
// Estas pruebas son nuevas de esta fusión: no existían en el verificar.mjs
// original de Bodega, porque en su proyecto Supabase original "authenticated"
// ya equivalía a "tiene cuenta en Bodega" — no hacía falta distinguir. Dentro
// de Unificador-QR eso deja de ser cierto (ver el ajuste de seguridad
// documentado en el encabezado de 0002_rls.sql), así que hace falta probarlo
// explícito.

prueba('un usuario de Unificador-QR sin rol_bodega no puede leer ni registrar nada de Bodega', async () => {
  const sinAcceso = await crearUsuarioUnificadorQR('apr-sin-bodega@wilug.cl', 'APR Sin Bodega', { rol: 'apr' })

  // Lectura: las políticas ya no son `using (true)` — exigen que
  // mi_rol_bodega() no sea null. Hay bodegas y stock de sobra creados por
  // pruebas anteriores; este usuario debe ver cero filas, no un error.
  const { rows: bodegasVistas } = await como(sinAcceso, () => db.query(`select * from bodegas`))
  if (bodegasVistas.length !== 0) {
    throw new Error(`Un usuario sin rol_bodega vio ${bodegasVistas.length} bodega(s): la lectura no está compartimentada`)
  }
  const { rows: stockVisto } = await como(sinAcceso, () => db.query(`select * from v_stock`))
  if (stockVisto.length !== 0) {
    throw new Error(`Un usuario sin rol_bodega vio ${stockVisto.length} fila(s) de v_stock`)
  }
  const { rows: movimientosVistos } = await como(sinAcceso, () => db.query(`select * from v_movimientos`))
  if (movimientosVistos.length !== 0) {
    throw new Error(`Un usuario sin rol_bodega vio ${movimientosVistos.length} movimiento(s)`)
  }

  // Escritura: mi_rol_bodega() es null, así que registrar_movimiento lo
  // rechaza antes de mirar siquiera el tipo de movimiento.
  await debeFallar(
    () =>
      mover(sinAcceso, {
        tipo: 'AJUSTE',
        bodega_id: ctx.bodega,
        motivo: 'Intento sin rol de Bodega',
        lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
      }),
    'acceso al módulo de Bodega',
  )

  // Y tampoco puede elegir una bodega de sesión.
  await debeFallar(() => fijarBodegaActual(sinAcceso, ctx.bodega), 'acceso al módulo de Bodega')
})

prueba('una cuenta con estado inactivo pierde su rol de Bodega aunque rol_bodega siga seteado', async () => {
  const persona = await crearUsuarioUnificadorQR('inactivo-bodega@wilug.cl', 'Cuenta Que Se Inactiva')
  await fijarRolBodega(ctx.admin, persona, 'BODEGUERO')
  await db.query(`update usuarios set bodega_actual_id = $1 where id = $2`, [ctx.bodega, persona])

  // Con la cuenta activa, funciona como cualquier Bodeguero (AJUSTE es solo
  // ADMIN, así que la prueba usa SALIDA_SALA, que sí le corresponde).
  await mover(persona, {
    tipo: 'SALIDA_SALA',
    bodega_id: ctx.bodega,
    sala_id: ctx.sala,
    lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
  })

  // Al desactivarla (mismo mecanismo con que Unificador-QR da de baja a
  // cualquier usuario, ver fix_seguridad_qa.sql), mi_rol_bodega() debe dejar
  // de verla — no basta con haber seteado rol_bodega alguna vez.
  await db.query(`update usuarios set estado = 'inactivo' where id = $1`, [persona])
  await debeFallar(
    () =>
      mover(persona, {
        tipo: 'SALIDA_SALA',
        bodega_id: ctx.bodega,
        sala_id: ctx.sala,
        lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
      }),
    'acceso al módulo de Bodega',
  )

  await db.query(`update usuarios set estado = 'activo' where id = $1`, [persona])
})

prueba('fijar_rol_bodega: solo un ADMIN de Bodega puede asignarle el rol a otro usuario', async () => {
  const objetivo = await crearUsuarioUnificadorQR('objetivo-rol@wilug.cl', 'Objetivo Rol')

  // Un Bodeguero, aunque sí tiene acceso a Bodega, no puede tocar el rol de
  // otro usuario.
  await debeFallar(() => fijarRolBodega(ctx.bodeguero, objetivo, 'BODEGUERO'), 'Solo un Administrador de Bodega')
  const sigueSinRol = await unaFila(`select rol_bodega from usuarios where id = $1`, [objetivo])
  if (sigueSinRol.rol_bodega !== null) throw new Error('El Bodeguero pudo asignar un rol de Bodega sin ser ADMIN')

  // Consulta tampoco.
  await debeFallar(() => fijarRolBodega(ctx.consulta, objetivo, 'ADMIN'), 'Solo un Administrador de Bodega')

  // El ADMIN sí puede, y puede quitarlo pasando null.
  await fijarRolBodega(ctx.admin, objetivo, 'CONSULTA')
  const conRol = await unaFila(`select rol_bodega from usuarios where id = $1`, [objetivo])
  if (conRol.rol_bodega !== 'CONSULTA') throw new Error(`El ADMIN no pudo asignar CONSULTA: quedó "${conRol.rol_bodega}"`)

  await fijarRolBodega(ctx.admin, objetivo, null)
  const sinRolDeNuevo = await unaFila(`select rol_bodega from usuarios where id = $1`, [objetivo])
  if (sinRolDeNuevo.rol_bodega !== null) throw new Error('fijar_rol_bodega con null no quitó el acceso')
})

prueba('RLS: un UPDATE directo de rol_bodega o bodega_actual_id sin pasar por las funciones afecta 0 filas', async () => {
  // La tabla `usuarios` de este arnés no tiene ninguna política de UPDATE
  // para `authenticated` (ver prepararEntornoSupabase) — mismo criterio que
  // ya probaron `fijar_foto_articulo`/`fijar_bodega_actual` sobre
  // `articulos`/`perfiles` en el Bodega original: un UPDATE bloqueado por
  // RLS no lanza error, afecta cero filas.
  const antes = await unaFila(`select rol_bodega, bodega_actual_id from usuarios where id = $1`, [ctx.bodeguero])

  const r1 = await como(ctx.bodeguero, () =>
    db.query(`update usuarios set rol_bodega = 'ADMIN' where id = $1`, [ctx.bodeguero]),
  )
  if (r1.affectedRows !== 0) throw new Error(`Un Bodeguero pudo auto-ascenderse: affectedRows=${r1.affectedRows}`)

  const r2 = await como(ctx.bodeguero, () =>
    db.query(`update usuarios set bodega_actual_id = $1 where id = $2`, [ctx.bodegaFaena, ctx.bodeguero]),
  )
  if (r2.affectedRows !== 0) throw new Error(`Un Bodeguero pudo cambiarse la bodega por UPDATE directo: affectedRows=${r2.affectedRows}`)

  const despues = await unaFila(`select rol_bodega, bodega_actual_id from usuarios where id = $1`, [ctx.bodeguero])
  if (antes.rol_bodega !== despues.rol_bodega || antes.bodega_actual_id !== despues.bodega_actual_id) {
    throw new Error('La fila cambió pese a que el UPDATE no debía tener efecto')
  }
})

prueba('un usuario con rol=coordinador y rol_bodega=ADMIN simultáneo funciona en ambos dominios sin interferencia', async () => {
  const doble = await crearUsuarioUnificadorQR('coordinador-bodega@wilug.cl', 'Coordinador y Admin Bodega', {
    rol: 'coordinador',
  })
  await fijarRolBodega(ctx.admin, doble, 'ADMIN')

  const fila = await unaFila(`select rol, rol_bodega from usuarios where id = $1`, [doble])
  if (fila.rol !== 'coordinador') throw new Error(`El rol general se perdió: quedó "${fila.rol}"`)
  if (fila.rol_bodega !== 'ADMIN') throw new Error(`El rol de Bodega se perdió: quedó "${fila.rol_bodega}"`)

  // Puede hacer lo que un ADMIN de Bodega haría: un AJUSTE, reservado a ADMIN.
  await mover(doble, {
    tipo: 'AJUSTE',
    bodega_id: ctx.bodega,
    motivo: 'Ajuste de prueba del coordinador que también es ADMIN de Bodega',
    lineas: [{ articulo_id: ctx.cable, cantidad: 1 }],
  })

  // Y puede asignar rol_bodega a otro usuario, por ser ADMIN de Bodega — no
  // hace falta simular nada del dominio general de coordinador, solo
  // confirmar que tener ambos campos a la vez no rompe ninguno de los dos.
  const tercero = await crearUsuarioUnificadorQR('tercero-doble@wilug.cl', 'Tercero')
  await fijarRolBodega(doble, tercero, 'CONSULTA')
  const filaTercero = await unaFila(`select rol_bodega from usuarios where id = $1`, [tercero])
  if (filaTercero.rol_bodega !== 'CONSULTA') throw new Error('El coordinador+ADMIN no pudo asignar rol_bodega a otro usuario')
})

// --- corrida ------------------------------------------------------------------

await prepararEntornoSupabase()

let ok = 0
let fallidos = 0
for (const { nombre, fn } of casos) {
  try {
    await fn()
    console.log(`  ✓ ${nombre}`)
    ok++
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`)
    fallidos++
  }
}

console.log(`\n${ok} correcta(s), ${fallidos} fallida(s)`)
await db.close()
process.exit(fallidos > 0 ? 1 : 0)
