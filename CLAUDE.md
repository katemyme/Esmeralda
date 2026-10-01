# Sistema Esmeralda — guía para Claude Code

Sistema web de inventario, ventas (POS) y caja para **Esmeralda Experience** (estudio de perforaciones
y joyería): sucursales Multicentro Las Américas (`LAM`) y Multicentro Las Brisas (`LBR`) y una
bodega central (`BOD`, en casa del dueño). Todo el texto para el usuario va en **español**.

## Reglas de trabajo

- **Nunca** agregar a Claude como colaborador: sin `Co-Authored-By`, sin `Claude-Session`, sin
  "Generated with Claude Code" en commits ni PRs (ya configurado en `.claude/settings.json`).
- Avanzar **paso a paso**: cada paso con sus pruebas, todas en verde, y un commit descriptivo en español.
- No subir a GitHub hasta que el dueño lo pida.
- Moneda base: córdobas (NIO). Pagos en NIO o USD. Fechas en `timestamptz`; reportes en `America/Managua`,
  semana de lunes a domingo.

## Estructura

```
db/01_esquema.sql      Tablas, reglas, funciones fn_* y vistas v_* (fuente de verdad del negocio)
db/02_seed.sql         Datos iniciales: ubicaciones, roles, permisos, parámetros, gamas, denominaciones, admin
db/03_datos_demo.sql   Datos de demostración (solo desarrollo)
db/04_pruebas.sql      255 pruebas de reglas de negocio
db/scripts/probar.sh   Recrea la BD esmeralda_test y corre todas las pruebas (Linux)
db/scripts/probar.ps1  Lo mismo en Windows (atajo: db\scripts\probar.cmd)
docs/                  Modelo de datos (HTML) y plantilla Excel de carga inicial
```

## Base de datos (PostgreSQL 16, esquema v1.1 terminado)

- Las reglas del negocio viven **en la base de datos** (funciones `fn_*`, triggers y CHECK). El backend
  no reimplementa reglas: llama a las funciones dentro de una transacción.
- Antes de cada operación el backend ejecuta `SET LOCAL app.usuario_id = '<id>'` (auditoría).
- Cada `fn_*` valida permisos (`fn_exigir_permiso`) y ubicación (`fn_exigir_sucursal`).
- Tablas de movimiento son de solo inserción: `movimiento_inventario`, `venta_detalle`, `venta_pago`,
  `cierre_caja_detalle`. Las ventas se anulan, no se borran.
- Para cambiar el esquema: editar `db/01_esquema.sql` (y `02_seed.sql` si aplica), agregar pruebas en
  `db/04_pruebas.sql` y correr `bash db/scripts/probar.sh` (Windows: `db\scripts\probar.cmd`) hasta ver
  `*** TODAS LAS PRUEBAS PASARON ***`. (La línea `ERROR: Venta LBR-MANUAL...` es esperada: prueba un trigger diferido.)
- Las pruebas comparan algunos mensajes del sistema en inglés ("duplicate key"): en un PostgreSQL
  instalado en español, la base de prueba necesita `lc_messages = 'C'` (probar.ps1 ya lo fija).

## Decisiones de negocio clave

- Toda compra entra a la bodega (solo el admin). Gastos de importación prorrateados por valor;
  costo promedio ponderado (incluye lo que va en tránsito). El costeo usa la cantidad **facturada**.
- Envíos en dos pasos: sale al enviar, entra lo escaneado al recibir; faltantes → alerta.
- Mermas y conteos: la sucursal reporta/cuenta, el admin aprueba.
- Se vende pieza, servicio (solo perforación) o **paquete** (perforación + pieza escaneada, cantidad 1).
  Precio del paquete: precio especial → tabla perforación × gama (acero clásica/lujo) → servicio + pieza (titanio).
- El precio cobrado puede subir (máx. +50 %, parámetro), nunca bajar. La única rebaja es una
  **promoción** activa y vigente (una por venta, sobre toda la venta), creada por el admin.
- Venta con `clave_idempotencia` (UUID del POS) para evitar duplicados.
- Caja: un turno al día por sucursal, compartido. Arqueo ciego por denominación; retiro de efectivo;
  lo que queda es el fondo del día siguiente. Diferencia > C$100 → justificación + alerta.
- Roles: ADMIN (todo), ENCARGADO (ventas, anulaciones, recibir, reportar mermas, contar, ver
  diferencias), VENDEDOR (vender, subir precio, promociones, caja, recibir, reportar mermas, contar).
- Acceso: el admin entra desde cualquier equipo; encargados y vendedores solo desde un **equipo registrado**
  (caja o tablet) de una de sus sucursales (`fn_equipo_autorizado`). La sesión dura 12 h si se abrió en un
  equipo registrado y 7 días si no (parámetros `SESION_HORAS_EQUIPO`, `SESION_DIAS_SIN_EQUIPO`); renovar no la
  alarga. 5 contraseñas incorrectas → bloqueo de 15 min. Reusar un token de renovación ya rotado → se cierran
  todas las sesiones del usuario y se alerta (`SESION_REUTILIZADA`).

Documentos de referencia (claude.ai): "Sistema Esmeralda — Documento de diseño" y
"Sistema Esmeralda — Resumen para la dirección".

## Etapa actual: backend (`backend/`)

Stack: Node 22.12+ (desarrollo en Node 24) + TypeScript, **NestJS**, **Kysely** + `pg` (consultas tipadas; llama a las `fn_*`),
Zod para validar entrada, argon2id para contraseñas, JWT de acceso (15 min) + refresh en cookie httpOnly
(hash SHA-256 en tabla `sesion`), pruebas con Jest + supertest contra una BD de prueba.

| Paso | Contenido |
|---|---|
| B1 ✅ | Proyecto base, conexión a PostgreSQL, configuración, transacción con `app.usuario_id` |
| B2 ✅ | Login, sesión renovable, bloqueo por intentos, cambio obligatorio de contraseña, registro de equipos |
| B3 | Panel admin: usuarios, roles/permisos, equipos, parámetros, alertas |
| B4 | Catálogo: productos, perforaciones, gamas, precios de paquetes, promociones |
| B5 | Inventario: compras, envíos/recepción, mermas, conteos |
| B6 | POS y caja: venta, cobro, apertura, cierre, ticket |
| B7 | Reportes, exportación (Excel/PDF), tarea programada `fn_alertar_cajas_sin_cerrar` |

### Convenciones del backend

- Comandos (en `backend/`): `npm run verificar` (tipos + oxlint + Prettier + Jest) debe quedar en verde
  antes de cada commit; `npm run start:dev`; `npm run db:recrear` (base local de desarrollo);
  `npm run db:tipos` después de cambiar el esquema (regenera `src/base-datos/tipos-bd.ts`, no editarlo a mano).
- Versiones: NestJS 12 y Kysely 0.29 se publican **solo como ESM**; el proyecto compila a CommonJS y Node los
  carga con `require(esm)` (como la plantilla oficial "ts" de Nest 12). Jest corre con `--experimental-vm-modules`.
  TypeScript fijado en **6.0** porque ts-jest aún no soporta TypeScript 7.
- Configuración: variables de entorno validadas con Zod en `src/configuracion/configuracion.ts`
  (`backend/.env`, no se sube; plantilla en `.env.example`). `DATABASE_URL` lleva la contraseña
  (codificada, `@` → `%40`): `pg` 8.23 marcó como obsoleto leer `pgpass.conf`. `JWT_SECRETO` (≥ 32 caracteres,
  `npm run secreto`), `LOGIN_LIMITE_POR_MINUTO` (por IP) y `TRUST_PROXY` (detrás de nginx/Caddy).
- API: rutas bajo `/api`; JSON en **snake_case** (igual que la base: `debe_cambiar_password`, `sucursal_id`).
  Entrada validada con `@Body(new ValidacionZod(esquema))` → 400 `DATOS_INVALIDOS` con `errores` por campo.
- Autenticación (`src/autenticacion/`): toda ruta exige `Authorization: Bearer <JWT>` salvo `@Publica()`;
  con contraseña temporal solo pasan las `@PermitidaConPasswordTemporal()`. `@UsuarioActual()` da
  `{ id, sesionId, rol, debeCambiarPassword, equipo: { id, sucursalId, cajaId } | null }` → usar `id` como
  `usuarioId` de `transaccion()` y `equipo` para validar sucursal/caja (B6). Cookies httpOnly + SameSite=Strict:
  `esmeralda_sesion` (refresh, path `/api/auth`) y `esmeralda_equipo` (equipo registrado, path `/api`, 400 días).
- Contraseñas: argon2id; se aceptan los hashes **bcrypt** del seed (`$2a$`, vía `crypt()`) y, como el seed obliga
  a cambiarla al entrar, la nueva queda en argon2id. La política (mín. 8, letras y números) vive en
  `esquemas.ts` porque la base nunca ve el texto plano.
- Escrituras: siempre con `BaseDatosService.transaccion(usuarioId, async (trx) => ...)`, que fija
  `app.usuario_id` con `set_config(..., true)` (= `SET LOCAL`). Las `fn_*` se llaman con
  ``sql`select fn_x(${a}, ${b})`.execute(trx)``. Las lecturas simples pueden usar `bd.db`.
- Tipos al leer: `bigint` → number, `date` → texto `AAAA-MM-DD`, `numeric` → texto (montos exactos),
  `timestamptz` → Date. Configurado en `tipos-pg.ts` y `.kysely-codegenrc.json` (deben coincidir).
- Errores: `FiltroErrores` responde `{ codigo, mensaje }` en español. Los `RAISE EXCEPTION` de la base se
  reenvían tal cual (P0001 → 422, 42501 → 403, 23001 → 409); las violaciones de restricción generadas por
  PostgreSQL se reemplazan por texto genérico + `restriccion`. Error propio: `new HttpException({ codigo, mensaje }, estado)`.
- Pruebas: `src/**/*.spec.ts` (unitarias e integración) y `test/**/*.e2e-spec.ts` (supertest). Usan la base
  `esmeralda_api_test` (o `TEST_DATABASE_URL`), recreada desde `db/01..03` en cada corrida. Dentro de Jest
  `instanceof Error` falla con errores del núcleo de Node: revisar propiedades (`code`, `message`).
  `test/utilidades.ts` tiene `crearApp()` y `cookiePuesta()`. En SQL de prueba, una función que modifica datos
  y la lectura que la verifica van en sentencias distintas (una sentencia no ve sus propios cambios).
