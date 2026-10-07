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

## Estado actual

_Actualizado el 2026-10-07._

- **Terminado y aprobado por el dueño:** esquema de base de datos v1.1 y los pasos **B1**, **B2** (etiqueta
  `guardado-b2`), **B3**, **B4**, **B5** y **B6** del backend. Con B5 se hizo también todo lo que había quedado fuera de
  B3 y B4: sucursales y cajas, roles nuevos, desbloqueo, mínimo de parámetros, bitácora, fotos, historial de
  precios, búsqueda para la venta, existencias y la carga inicial desde Excel. El dueño aprobó B5 el 2026-10-06
  (reglas para desactivar sucursales y eliminar roles, visibilidad por sucursal, fotos públicas con nombre al
  azar, carga inicial que no duplica; el aviso de exceljs se queda así) con dos ajustes ya hechos: la carga
  inicial actualiza el precio de los productos que ya existen, y pruebas de que las facturas no dejan saltos.
- **B6 (POS y caja) aprobado el 2026-10-07:** el dueño aprobó las siete decisiones (están en «Decisiones de
  negocio clave») y lo reportado, y respondió las preguntas abiertas: la carga inicial actualiza también el precio
  de solo servicio de las perforaciones que ya existen (hecho); los envíos se quedan con su SEQUENCE (ahí los
  saltos no importan); el RUC y la leyenda del ticket quedan vacíos y él los llena en el panel. Pidió además un
  control del tipo de cambio (variación máxima con confirmación y rango del primero), ya hecho.
- **En curso:** **B7** (reportes). El dueño aprobó el plan y sus decisiones el 2026-10-07 (están en «Decisiones de
  negocio clave», «Reportes»). **Pendiente:** el frontend (no empezarlo).
- Pruebas en verde: 490 de base de datos y 409 del backend. Nada se ha subido a GitHub.
- Fuera de B5 (decidir si entran más adelante): descargar la plantilla desde la API (hoy está en `docs/`),
  redimensionar las fotos al subirlas, el inventario valorizado (`v_inventario_valorizado`, va con los reportes de
  B7) y borrar las fotos sueltas que nunca se usaron.
- Fuera de B6: devoluciones de ventas de un turno ya cerrado (fase 2), el ticket en PDF y la tarea programada
  `fn_alertar_cajas_sin_cerrar` (los dos van con B7) y un historial del tipo de cambio. Quien confirma un tipo de
  cambio fuera del límite queda en la bitácora, pero no genera una alerta (se le planteó al dueño con B7).
- Después de cambiar `db/01_esquema.sql` o `db/02_seed.sql` (el 2026-10-07: `fn_set_tipo_cambio` y el parámetro
  `TIPO_CAMBIO_VARIACION_MAX`) la base local `esmeralda` queda atrás hasta que se corra `npm run db:recrear`
  (borra lo que tenga: mirar antes si el dueño ya guardó datos propios).

**Levantar el servidor** (desde `backend/`):

```
npm install             solo la primera vez
copy .env.example .env  solo la primera vez: poner DATABASE_URL y JWT_SECRETO (npm run secreto)
npm run db:recrear      crea la base local "esmeralda" con esquema + seed + datos demo (borra la anterior);
                        hay que repetirlo cuando cambia db/01_esquema.sql
npm run start:dev       API en http://localhost:3000/api  →  probar con http://localhost:3000/api/salud
```

Usuarios de la base local: `admin` / `Esmeralda#2026` (temporal: pide cambiarla al entrar); demo `maria.lopez`
(encargada), `ana.martinez` y `carlos.ruiz` (vendedores) / `Demo#2026`. Para detener el servidor: Ctrl+C.

**Correr las pruebas:**

```
db\scripts\probar.cmd   desde la raíz: reglas de la base  →  *** TODAS LAS PRUEBAS PASARON ***
npm run verificar       desde backend/: tipos + oxlint + Prettier + Jest (unitarias, integración y API)
```

Las dos usan bases propias que se borran y recrean en cada corrida (`esmeralda_test` y `esmeralda_api_test`);
no tocan la base local `esmeralda`.

## Estructura

```
db/01_esquema.sql      Tablas, reglas, funciones fn_* y vistas v_* (fuente de verdad del negocio)
db/02_seed.sql         Datos iniciales: ubicaciones, roles, permisos, parámetros, gamas, denominaciones, admin
db/03_datos_demo.sql   Datos de demostración (solo desarrollo)
db/04_pruebas.sql      490 pruebas de reglas de negocio
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
- Número de factura: correlativo por sucursal (`sucursal.ultimo_numero_venta`, `LAM-00000001`) que
  `fn_registrar_venta` toma dentro de la misma transacción de la venta. No deja saltos si la venta falla o se
  reintenta con la misma clave; no cambiarlo por una SEQUENCE (no se devuelve al deshacer). Solo las facturas
  van sin saltos: el número de los envíos (`ENV-000001`) se queda con su SEQUENCE (decisión del dueño, 2026-10-07).
- Caja: un turno al día por sucursal, compartido. Arqueo ciego por denominación; retiro de efectivo;
  lo que queda es el fondo del día siguiente. Diferencia > C$100 → justificación + alerta.
- Roles: ADMIN (todo), ENCARGADO (ventas, anulaciones, recibir, reportar mermas, contar, ver
  diferencias), VENDEDOR (vender, subir precio, promociones, caja, recibir, reportar mermas, contar).
- Acceso: el admin entra desde cualquier equipo; encargados y vendedores solo desde un **equipo registrado**
  (caja o tablet) de una de sus sucursales (`fn_equipo_autorizado`). La sesión dura 12 h si se abrió en un
  equipo registrado y 7 días si no (parámetros `SESION_HORAS_EQUIPO`, `SESION_DIAS_SIN_EQUIPO`); renovar no la
  alarga. 5 contraseñas incorrectas → bloqueo de 15 min. Reusar un token de renovación ya rotado → se cierran
  todas las sesiones del usuario y se alerta (`SESION_REUTILIZADA`).
- Reglas agregadas con el backend (B3 a B5), todas en la base:
  - Se pueden crear roles nuevos; solo se elimina un rol que no es de sistema y sin usuarios.
  - Las sucursales nuevas son siempre de venta (la bodega es única). El código de una sucursal no cambia si ya
    tiene ventas. No se desactiva una sucursal con existencias, turno abierto o envíos en tránsito, ni la bodega;
    en una sucursal o caja inactiva no se abren turnos.
  - No se desactiva un producto o variante con existencias. Las perforaciones (SERVICIO y PAQUETE) solo se
    administran desde su pantalla. Una gama con piezas o precios no cambia de modo de precio.
  - `PRECIOS_EDITAR` permite cambiar precio **y costo** a mano (además del costo promedio de las compras).
  - Las duraciones de sesión tienen mínimo 1 (`parametro.minimo`).
  - Carga inicial: solo crea lo que falta; el inventario inicial entra a la bodega y se reparte con envíos. De
    lo que ya existe solo cambia precios: tabla de paquetes, precios especiales, precio de solo servicio de las
    perforaciones y precio de venta de los productos (el costo no: es el promedio de las compras).
- POS y caja (B6; decisiones del dueño del 2026-10-06), todas en la base:
  - La sucursal, la caja y el turno **no los manda la pantalla**: salen del equipo registrado de la sesión
    (`fn_caja_de_sesion`, `fn_turno_de_sesion`). PC de caja → su caja. Tablet → la única caja abierta de su
    sucursal (con dos abiertas, se trabaja desde la PC de la caja); para abrir, la única caja activa. El
    **administrador** sin caja en su equipo (o sin equipo registrado) indica la caja y puede vender, abrir y
    cerrar; sentado en una PC de caja usa la de ese equipo. Encargados y vendedores nunca eligen.
  - **Arqueo ciego:** quien abre o cierra nunca ve el monto esperado ni la diferencia. Se abre declarando lo
    contado, sin ver el fondo que dejó el cierre anterior. Lo esperado y las diferencias solo se ven con
    `CAJA_VER_DIFERENCIAS`.
  - **Un solo reconteo:** si el primer conteo no cuadra (más que la tolerancia) y no trae justificación, la caja
    no se cierra y queda anotado (`turno_caja.intentos_cierre`); desde el segundo, la justificación es obligatoria
    —cuadre o no— y se cierra con lo contado. Así no se puede adivinar lo esperado probando conteos.
  - **Ticket de cierre:** quien cierra recibe lo que contó, lo que retiró y el fondo; lo vendido y lo cobrado por
    método solo con `CAJA_VER_DIFERENCIAS`. En un cierre forzado (sin conteo) el ticket reducido no trae montos.
  - **Tipo de cambio:** solo se registra el de hoy y se puede corregir durante el día (`fn_set_tipo_cambio`); cada
    venta guarda el suyo, así que el cambio vale para las ventas siguientes. Los días anteriores no se editan.
    Control contra errores de dedo (pedido del dueño, 2026-10-07): si el valor se aleja del **último registrado**
    (el vigente, sea de hoy o de un día anterior) más que el parámetro `TIPO_CAMBIO_VARIACION_MAX` (5 %; justo
    el 5 % pasa), se rechaza salvo confirmación explícita. Si no hay ninguno anterior, solo entra entre 20 y 60
    (fijo en la función; ahí la confirmación no cuenta).
  - **Ticket de venta:** la API entrega los datos y la pantalla lo imprime (el PDF va con B7). Encabezado y pie
    con los parámetros `NEGOCIO_NOMBRE`, `NEGOCIO_RUC` y `TICKET_LEYENDA` (el RUC y la leyenda están vacíos: el
    dueño los llena en el panel).
- Reportes (B7; decisiones del dueño del 2026-10-07):
  - **Solo el administrador ve costos:** costo, margen e inventario valorizado piden `REPORTES_COSTOS`, que solo
    tiene el ADMIN. El encargado ve ventas, cobros, cierres y mermas en cantidades, de sus sucursales. El
    vendedor no ve reportes. No hay permisos nuevos.
  - **Arqueo ciego en los reportes:** sin `CAJA_VER_DIFERENCIAS`, los reportes de ventas y cobros no incluyen
    las ventas de un turno todavía abierto (con ellas se deduciría lo esperado en caja).
  - **Inventario valorizado:** la foto de hoy y, además, una foto automática al cierre de cada mes.
  - **Mermas:** suman solo las aprobadas, con el costo del momento en que se aprobaron; las pendientes y las
    rechazadas se listan aparte.
  - **Tickets en PDF:** papel de 80 mm; la reimpresión lleva la palabra «COPIA».
  - **Alertas:** una nueva cuando alguien confirma un tipo de cambio fuera del límite. El stock bajo el mínimo
    no es alerta: es el reporte «por reponer». Las alertas siguen solo en el panel (correo y WhatsApp, fuera).
  - **Reportes extra incluidos:** productos más vendidos, perforaciones con pieza contra solo servicio, ventas
    por gama, promociones y sobreprecios.

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
| B3 ✅ | Panel admin: usuarios, roles/permisos, equipos, parámetros, alertas |
| B4 ✅ | Catálogo: productos, perforaciones, gamas, precios de paquetes, promociones |
| B5 ✅ | Inventario: compras, envíos/recepción, mermas, conteos (y carga inicial desde Excel) |
| B6 ✅ | POS y caja: venta, cobro, apertura, cierre, ticket |
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
  `npm run secreto`), `LOGIN_LIMITE_POR_MINUTO` (por IP), `TRUST_PROXY` (detrás de nginx/Caddy) y `DIR_FOTOS`
  (carpeta de las fotos subidas; en el servidor debe entrar en los respaldos).
- API: rutas bajo `/api`; JSON en **snake_case** (igual que la base: `debe_cambiar_password`, `sucursal_id`).
  Entrada validada con `@Body(new ValidacionZod(esquema))` → 400 `DATOS_INVALIDOS` con `errores` por campo.
- Autenticación (`src/autenticacion/`): toda ruta exige `Authorization: Bearer <JWT>` salvo `@Publica()`;
  con contraseña temporal solo pasan las `@PermitidaConPasswordTemporal()`. `@UsuarioActual()` da
  `{ id, sesionId, rol, debeCambiarPassword, equipo: { id, sucursalId, cajaId } | null }` → usar `id` como
  `usuarioId` de `transaccion()` y `equipo` para validar sucursal/caja (B6). Cookies httpOnly + SameSite=Strict:
  `esmeralda_sesion` (refresh, path `/api/auth`) y `esmeralda_equipo` (equipo registrado, path `/api`, 400 días).
- Permisos: cada ruta que no sea de uso general lleva `@RequierePermiso('CODIGO')` (`src/autenticacion/permisos.ts`),
  que llama a `fn_exigir_permiso` **antes** de validar los datos enviados (403 `PERMISO_DENEGADO`). El permiso se
  consulta en la base en cada solicitud (el token solo lleva el rol): cambiar los permisos de un rol o desactivar
  a un usuario aplica de inmediato. En las escrituras la `fn_*` lo valida otra vez dentro de la transacción.
- Contraseñas: argon2id; se aceptan los hashes **bcrypt** del seed (`$2a$`, vía `crypt()`) y, como el seed obliga
  a cambiarla al entrar, la nueva queda en argon2id. La política (mín. 8, letras y números) vive en
  `esquemas.ts` porque la base nunca ve el texto plano. Al crear un usuario o resetear su contraseña, el backend
  genera la **contraseña temporal** (`generarPasswordTemporal`, p. ej. `k7mx-9qdw-t3hp`) y la devuelve una sola vez.
- Panel (B3): un módulo por recurso (`usuarios/`, `roles/`, `equipos/`, `parametros/`, `alertas/`, `sucursales/`),
  cada uno con `*.controller.ts`, `*.service.ts` y `esquemas.ts`. Respuestas con el recurso envuelto
  (`{ usuario }`, `{ usuarios }`). Ids de la ruta con `@Param('id', idEntero())` / `idUuid()` (`src/comun/esquemas.ts`);
  recurso inexistente en una lectura → `throw new NoEncontrado('...')` (404). Editar parámetros y permisos de un rol
  pasa por `fn_set_parametro` y `fn_set_permisos_rol` (el rol ADMIN no se edita; nadie otorga un permiso que no tiene).
  Solo un administrador puede editar, desactivar, resetear la contraseña o cerrar las sesiones de otro
  administrador (`fn_exigir_gestion_usuario`), aunque otro rol reciba `USUARIOS_GESTIONAR`.
- Vistas (`v_*`) en Kysely: los tipos generados marcan todas sus columnas como posiblemente nulas; se declara la
  fila real y se usa `.$castTo<Fila>()`.
- Catálogo (B4): módulos `categorias/`, `gamas/`, `productos/` (productos y variantes), `perforaciones/` y
  `promociones/`. Toda escritura pasa por una `fn_*` (`fn_guardar_categoria`, `fn_guardar_gama`,
  `fn_guardar_producto`, `fn_crear_variante`, `fn_actualizar_variante`, `fn_set_precio_variante`,
  `fn_actualizar_perforacion`, `fn_set_*_activ[oa]`...). Las perforaciones son productos de tipo SERVICIO y
  PAQUETE: aparecen en `/api/productos`, pero solo se administran en `/api/perforaciones`. Reglas de la base: no
  se desactiva un producto o variante con existencias; una gama con piezas o precios no cambia de modo de precio;
  la categoría "Perforaciones" es del sistema.
- Montos en la entrada: `monto()` / `montoPositivo()` de `src/comun/esquemas.ts` aceptan número o texto con hasta
  2 decimales y entregan texto (`"650.5"`), que va a la base con `${valor}::numeric`. Los parámetros que pueden
  ser null llevan su tipo en el SQL (`${id}::integer`, `${fecha}::date`).
- El **costo** solo sale para quien tiene `REPORTES_COSTOS`: se enmascara en la propia consulta
  (`case when (select fn_tiene_permiso(usuario, 'REPORTES_COSTOS')) then v.costo end`), no en TypeScript.
- Lo que en la base se llama `activa` (categoría, gama, perforación, promoción, sucursal, caja) usa `esquemaActiva`
  y la ruta `/activa`; lo que se llama `activo` (usuario, equipo, producto, variante, proveedor), `esquemaActivo`
  y `/activo`.
- `@RequierePermiso('A', 'B')` con varios permisos pide **uno** de ellos (listas que ven tanto la sucursal como
  el admin: envíos, mermas, conteos); puede ir en el controlador entero (`proveedores`, `compras`).
- Inventario (B5): módulos `proveedores/`, `compras/`, `envios/`, `mermas/`, `conteos/` e `inventario/`. Alcance
  de las listas: cada quien ve lo de **sus** sucursales (`fn_puede_operar_sucursal` en el `where`); un registro
  ajeno responde 404. La cantidad de la bodega se oculta con `fn_ve_cantidad_bodega`. El conteo es a ciegas: el
  detalle del conteo no trae el stock del sistema; las diferencias piden `INVENTARIO_AJUSTAR`.
- Consultas con filtros opcionales: `donde(cond1, filtro.x && sql`...`)` y `patronContiene()` de
  `src/comun/consultas.ts`; fechas `desde`/`hasta` con `inicioDelDia()` / `finDelDia()` de `src/comun/fechas.ts`
  (día de Managua). Paginación: `limite` + `antes_de` (por id, listas que crecen) o `desplazamiento` (catálogos).
- Fotos (`fotos/`): se guardan en `DIR_FOTOS` (por defecto `backend/almacen/fotos`, fuera de Git) con nombre al
  azar; el formato se decide por el contenido (JPG, PNG, WebP; máx. 5 MB). `GET /api/fotos/:archivo` es pública
  porque una `<img>` no envía el token. La base solo guarda la dirección (`foto_url`).
- Carga inicial (`carga-inicial/`): `plantilla.ts` lee el Excel (exceljs) sin depender de fórmulas calculadas;
  el servicio valida cada fila con el **mismo esquema Zod** de la API y la guarda con la **misma `fn_*`**, todo
  en una transacción con un `savepoint` por fila para juntar todos los errores. Simula por defecto
  (`?aplicar=true` para guardar). Solo crea lo que falta; lo repetido dentro del archivo es error. A un producto
  que ya existe le actualiza el precio de venta con `fn_set_precio_variante` (pide `PRECIOS_EDITAR`, queda en el
  historial de precios y se cuenta en `resumen.precios_actualizados`); a una perforación que ya existe, igual
  con su precio de solo servicio (`resumen.precios_servicio_actualizados`). Un producto o una perforación que
  ya existe y viene dos veces en el archivo es un error (no se sabría qué precio vale).
- POS y caja (B6): módulos `caja/` (rutas `/api/caja/turno...`, `/api/turnos...`, `/api/metodos-pago`,
  `/api/denominaciones`), `ventas/` y `tipo-cambio/`. Ningún esquema de entrada lleva sucursal ni turno: los
  servicios reciben el `UsuarioAutenticado` completo y resuelven la caja con `caja/sesion-caja.ts`
  (`exigirTurno()`, `turnoDeSesion()`, `cajaParaAbrir()`), que pasa `usuario.equipo.id` a la base; esta vuelve a
  leer el equipo en cada solicitud (desactivarlo aplica de inmediato → 403). `caja_id` solo existe para el
  administrador sin caja en su equipo (sin equipo y sin `caja_id` → 400). Sin turno abierto → 409
  `SIN_TURNO_ABIERTO`.
  - `POST /api/ventas` exige `clave_idempotencia` (UUID): 201 la primera vez; 200 y `repetida: true` si la clave
    ya era de una venta del mismo vendedor y turno; si no, 409 `CLAVE_REUTILIZADA`. Alcance de las consultas:
    `VENTAS_VER_TODAS` → sus sucursales; solo `VENTAS_VER_PROPIAS` → las propias; una venta ajena responde 404.
  - Cierre: `fn_cerrar_turno` **no lanza error** cuando el primer conteo no cuadra (devuelve `{"cerrado": false}`
    para que el intento quede guardado); el servicio responde 422 `CONTEO_NO_CUADRA` después de confirmar la
    transacción. Ninguna respuesta de `/api/caja/...` trae montos esperados ni diferencias: solo `/api/turnos`
    (`CAJA_VER_DIFERENCIAS`). Qué trae el ticket de cierre lo decide la base (`fn_ticket_cierre(turno, completo)`).
  - Las funciones que devuelven JSON (`fn_ticket_cierre`) entregan los montos como número: el servicio los pasa a
    texto con 2 decimales, como el resto de la API.
  - `PUT /api/tipo-cambio` acepta `confirmar` (solo `true` cuenta). Cuando la base pide la confirmación lanza el
    SQLSTATE `ESM02`, que `FiltroErrores` traduce a 409 `CONFIRMACION_REQUERIDA` con el mensaje de la base: la
    pantalla pregunta y reenvía con `confirmar: true`. Sirve para cualquier otra función que pida confirmar.
  - `test/pos.e2e-spec.ts` trabaja en una sucursal propia (`PVE`) con su caja, su PC de caja y su tablet; usa una
    pieza de gama Titanio (las otras pruebas cuentan las piezas y los precios de las gamas de acero) y al final
    deja el tipo de cambio como estaba (una prueba borra los registrados mientras dura y los repone: vale porque
    Jest corre con `--runInBand`). Hace `app.listen(0)` porque envía dos solicitudes a la vez.
- Escrituras: siempre con `BaseDatosService.transaccion(usuarioId, async (trx) => ...)`, que fija
  `app.usuario_id` con `set_config(..., true)` (= `SET LOCAL`). Las `fn_*` se llaman con
  ``sql`select fn_x(${a}, ${b})`.execute(trx)``. Las lecturas simples pueden usar `bd.db`.
- Tipos al leer: `bigint` → number, `date` → texto `AAAA-MM-DD`, `numeric` → texto (montos exactos),
  `timestamptz` → Date. Configurado en `tipos-pg.ts` y `.kysely-codegenrc.json` (deben coincidir).
- Errores: `FiltroErrores` responde `{ codigo, mensaje }` en español. Los `RAISE EXCEPTION` de la base se
  reenvían tal cual (P0001 → 422, 42501 → 403, 23001 → 409, ESM02 → 409 `CONFIRMACION_REQUERIDA`); las violaciones de restricción generadas por
  PostgreSQL se reemplazan por texto genérico + `restriccion`. Error propio: `new HttpException({ codigo, mensaje }, estado)`.
- Pruebas: `src/**/*.spec.ts` (unitarias e integración) y `test/**/*.e2e-spec.ts` (supertest). Usan la base
  `esmeralda_api_test` (o `TEST_DATABASE_URL`), recreada desde `db/01..03` en cada corrida. Dentro de Jest
  `instanceof Error` falla con errores del núcleo de Node: revisar propiedades (`code`, `message`).
  `test/utilidades.ts` tiene `crearApp()` y `cookiePuesta()`. En SQL de prueba, una función que modifica datos
  y la lectura que la verifica van en sentencias distintas (una sentencia no ve sus propios cambios).
  Todos los archivos de prueba comparten la misma base y Jest no garantiza su orden: cada archivo e2e crea sus
  propios usuarios y equipos (`crearUsuarioDePrueba()`, `tokenDeAcceso()` y `registrarTablet()` de
  `test/utilidades.ts`) y sus propios datos; si cambia permisos de roles o parámetros, los restaura en `afterAll`.
