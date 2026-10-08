# Sistema Esmeralda

Sistema web de inventario, ventas (POS) y caja para **Esmeralda Experience**:
dos sucursales (Multicentro Las Américas y Multicentro Las Brisas) y una bodega central.

## Estado

| Parte | Estado |
|---|---|
| Diseño funcional | Completo |
| Base de datos (PostgreSQL 16) | v1.1 completa y probada |
| Backend (Node + TypeScript, NestJS) | Completo: B1 (base), B2 (login, sesiones, equipos), B3 (panel de administración), B4 (catálogo), B5 (inventario y carga inicial), B6 (POS y caja), B7 (reportes, exportación y tareas programadas) y B8 (devoluciones y cambios) |
| Frontend (React + Vite, PWA) | Pendiente |

## Estructura

```
backend/              API (NestJS + Kysely); ver "Backend" más abajo
db/
  01_esquema.sql      Tablas, reglas, funciones y vistas
  02_seed.sql         Datos iniciales: ubicaciones, roles, permisos, parámetros, gamas, admin
  03_datos_demo.sql   Datos de demostración (solo desarrollo)
  04_pruebas.sql      Pruebas de reglas de negocio
  scripts/probar.sh   Recrea la BD de prueba y ejecuta todas las pruebas (probar.cmd en Windows)
docs/
  modelo-datos.html              Diagrama entidad-relación, reglas y funciones (v1.1)
  plantilla-carga-inicial.xlsx   Plantilla de Excel para cargar el sistema antes de usarlo
```

## Instalar la base de datos

```bash
createdb esmeralda
psql -d esmeralda -f db/01_esquema.sql
psql -d esmeralda -f db/02_seed.sql
```

Usuario inicial: `admin` / `Esmeralda#2026` (temporal, se exige cambiarla en el primer ingreso).

## Ejecutar las pruebas

Linux:

```bash
sudo bash db/scripts/probar.sh
```

Windows (PowerShell o cmd, desde la raíz del repositorio):

```powershell
db\scripts\probar.cmd
```

Crea la base `esmeralda_test` desde cero, carga esquema + seed + demo y corre `04_pruebas.sql`.
En Windows la contraseña de `postgres` se lee de `%APPDATA%\postgresql\pgpass.conf`
(una línea `localhost:5432:*:postgres:CONTRASEÑA`) o se pide al iniciar.

## Backend

Requisitos: Node 22.12 o superior (probado con Node 24) y PostgreSQL 16 o superior.

```bash
cd backend
npm install
cp .env.example .env     # Windows: copy .env.example .env — complete DATABASE_URL y JWT_SECRETO
npm run secreto          # genera un valor para JWT_SECRETO
npm run db:recrear       # crea la base local "esmeralda" con esquema + seed + datos demo
npm run start:dev        # API en http://localhost:3000/api (se recarga al guardar cambios)
```

Comprobar que funciona: abrir <http://localhost:3000/api/salud> → `{"estado":"ok","baseDatos":"ok"}`.

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | Levanta la API en modo desarrollo (recarga automática) |
| `npm run build` y `npm run start:prod` | Compila a `dist/` y la ejecuta como en producción |
| `npm run verificar` | Tipos + lint + formato + todas las pruebas (deben quedar en verde antes de cada commit) |
| `npm test` | Solo las pruebas (Jest + supertest); recrea la base `esmeralda_api_test` en cada corrida |
| `npm run db:recrear` | Borra y recrea la base local de desarrollo (solo `localhost`, nunca en producción) |
| `npm run db:tipos` | Regenera los tipos de Kysely (`src/base-datos/tipos-bd.ts`) tras cambiar el esquema |
| `npm run secreto` | Genera un secreto aleatorio para `JWT_SECRETO` |

### Inicio de sesión y equipos

1. El admin entra (`admin` / `Esmeralda#2026`) desde cualquier equipo y el sistema lo obliga a cambiar la contraseña.
2. En cada PC de caja y cada tablet, el admin inicia sesión y **registra ese equipo** (`POST /api/equipos`):
   el navegador queda identificado con una cookie.
3. Encargados y vendedores trabajan con todo lo de su rol desde un equipo registrado de una de sus sucursales
   (sesión de 12 horas). Sin equipo registrado —su celular— también entran, pero solo con lo que vale sin
   equipo (ver «Acceso desde el celular»): sesión de 12 horas (`SESION_HORAS_CELULAR`). El admin sin equipo
   sigue con todo, 7 días. Un equipo registrado de otra sucursal responde 403 `EQUIPO_NO_AUTORIZADO`.

| Ruta | Qué hace |
|---|---|
| `POST /api/auth/login` | `{ username, password }` → token de acceso (15 min) + cookie de sesión |
| `POST /api/auth/refresh` | Renueva el token de acceso con la cookie (y la rota) |
| `POST /api/auth/logout` | Cierra la sesión |
| `GET /api/auth/yo` | Usuario, sucursales, equipo y `acceso` (`COMPLETO` o `CELULAR`) de la sesión; `permisos` trae solo los que valen en ella |
| `POST /api/auth/cambiar-password` | `{ password_actual, password_nueva }` (mín. 8, con letras y números) |
| `POST /api/equipos` | Registra este equipo: `{ nombre, tipo: CAJA/TABLET/MOVIL, sucursal_id, caja_id }` |
| `GET /api/equipos/actual` | Qué equipo registrado es este navegador |
| `GET /api/auth/pin/usuarios` | La pantalla de bloqueo de este equipo: `{ equipo, abierto, usuarios: [{ id, nombre_completo, pin_bloqueado }] }` |
| `POST /api/auth/pin` | `{ usuario_id, pin }` → entra con su PIN (misma respuesta que el login) |
| `PUT /api/auth/pin` | `{ password_actual, pin }`: crea o cambia el PIN propio (4 dígitos) |
| `POST /api/equipos/actual/cerrar` | Cierra este equipo al final del día: deja de aceptar PIN y cierra sus sesiones |

Las demás rutas exigen `Authorization: Bearer <token de acceso>`. Los errores responden
`{ codigo, mensaje }` en español (p. ej. `CREDENCIALES_INVALIDAS`, `CUENTA_BLOQUEADA`, `EQUIPO_NO_AUTORIZADO`).

### Cambio rápido con PIN

En una tablet compartida cada vendedora entra con un PIN de 4 dígitos en vez de escribir su contraseña.

- **El equipo se abre una vez al día.** La primera persona entra con usuario y contraseña; desde ese momento
  el equipo acepta PIN durante lo que dura la sesión (`SESION_HORAS_EQUIPO`, 12 horas) o hasta que alguien lo
  cierre (`POST /api/equipos/actual/cerrar`). Cerrado, un PIN no sirve: 403 `EQUIPO_CERRADO`.
- **Cada PIN abre la sesión de esa persona** (token y cookie propios, `sesion.metodo = PIN`): todo lo que
  haga queda a su nombre. Al bloquearse la pantalla, la app cierra esa sesión (`POST /api/auth/logout`).
- **Quién puede usar PIN en un equipo:** quien está asignada a la sucursal del equipo, activa y sin contraseña
  temporal. El administrador no tiene PIN, y desde un celular (sin equipo registrado) no se entra con PIN.
- **Crear el PIN:** `PUT /api/auth/pin`, confirmando con la contraseña. Cuatro dígitos; no se aceptan el mismo
  dígito cuatro veces ni escaleras (`0000`, `1234`, `9876`). Se guarda con hash (argon2id).
- **Bloqueo:** 5 PIN incorrectos seguidos lo bloquean (423 `PIN_BLOQUEADO`) y dejan una alerta `PIN_BLOQUEADO`
  al administrador. Se desbloquea creando uno nuevo (ella, con su contraseña) o con
  `POST /api/usuarios/:id/reiniciar-pin` (`USUARIOS_GESTIONAR`), que la deja sin PIN. Un PIN bloqueado no
  bloquea la contraseña. `POST /api/auth/pin` no lleva el límite por IP del login: el freno es este bloqueo.
- **Bloqueo de pantalla:** `/api/auth/yo` y el login traen `pantalla_bloqueo_minutos` (parámetro
  `PANTALLA_BLOQUEO_MINUTOS`, 3; de 1 a 30) y `usuario.pin` (`SIN_PIN`, `ACTIVO` o `BLOQUEADO`).
- Los parámetros numéricos pueden llevar ahora un tope (`parametro.maximo`), además del mínimo.

### Acceso desde el celular

Una sesión sin equipo registrado de quien no es administrador es «el celular» (`acceso: CELULAR`). En ella
solo valen los permisos marcados `sin_equipo` en la tabla `permiso`; con cualquier otro la API responde
403 `EQUIPO_REQUERIDO` («solo desde un equipo registrado de la sucursal»). Lo decide la base en cada solicitud
(`fn_permiso_en_sesion`).

| Desde el celular | Qué |
|---|---|
| Sí | Productos, precios, existencias y kardex; ver y recibir envíos; conteos; buscar una factura y solicitar su devolución (ver y cancelar las suyas); **vender**; los avisos de su sucursal; cambiar su contraseña |
| No | Abrir o cerrar la caja, movimientos de efectivo, anular, ejecutar devoluciones, imprimir en papel, registrar el tipo de cambio, mermas, reportes, turnos y diferencias, ver las ventas de otras personas |

- **Vender.** La venta entra al turno abierto de su sucursal, con las reglas de siempre, y queda a su nombre.
  `GET /api/caja/abiertas` (`VENTAS_REGISTRAR`) dice dónde puede vender: las cajas con turno abierto de sus
  sucursales (`turno_id`, `caja`, `sucursal`; sin montos). Con una sola no hace falta más; con varias —o si
  trabaja en varias sucursales— `POST /api/ventas` lleva `caja_id`. Sin turno abierto → 409 `SIN_TURNO_ABIERTO`.
- **Desde dónde se vendió.** Cada venta guarda su `origen`: `EQUIPO` (uno registrado de la sucursal) o `CELULAR`.
  Solo lo ve el administrador (`SUCURSALES_GESTIONAR`): en la venta, en el reporte de ventas (sección «Desde
  dónde se vendió») y en el de cierres (columna «Desde celular»). Para los demás llega en `null` o no sale.
- **Sus ventas.** Desde el celular `GET /api/ventas` y `GET /api/ventas/:id` solo traen las ventas que esa
  persona hizo en un turno que sigue abierto, tenga el permiso que tenga; cerrado el turno, responden vacío y 404.
  La lista no trae sumas: el arqueo sigue a ciegas.
- **Solicitar una devolución.** La sucursal que la solicita es la de la venta si trabaja en ella, o la única
  en la que trabaja; quien trabaja en varias envía `sucursal_id`.
- **Rutas que son solo del equipo** aunque su permiso valga en el celular: `GET /api/caja/turno`,
  `POST /api/ventas/:id/imprimir`, `POST /api/devoluciones/:id/ejecutar` y `POST /api/devoluciones/:id/imprimir`.
- La lista completa de lo que responde desde el celular está en `backend/test/celular.e2e-spec.ts`, en una
  prueba que recorre todas las rutas de la API: una ruta nueva que no esté en la lista debe pedir el equipo.

### Panel de administración

Cada ruta exige un permiso (el admin los tiene todos); sin él responde 403 `PERMISO_DENEGADO`.
El permiso se consulta en la base en cada solicitud: cambiar los permisos de un rol o desactivar
a un usuario aplica de inmediato.

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/usuarios` y `GET /api/usuarios/:id` | `USUARIOS_VER` | Usuarios con rol, estado (ACTIVO, INACTIVO, BLOQUEADO), sucursales y sesiones abiertas |
| `POST /api/usuarios` | `USUARIOS_GESTIONAR` | `{ nombre_completo, username, rol, sucursales, email, telefono }` → crea el usuario y devuelve su `password_temporal` (se muestra una sola vez) |
| `PUT /api/usuarios/:id` | `USUARIOS_GESTIONAR` | `{ nombre_completo, rol, sucursales, email, telefono }` (se envían todos) |
| `PUT /api/usuarios/:id/activo` | `USUARIOS_GESTIONAR` | `{ activo }`: desactivar cierra sus sesiones |
| `POST /api/usuarios/:id/resetear-password` | `USUARIOS_GESTIONAR` | Nueva `password_temporal`; también desbloquea la cuenta |
| `POST /api/usuarios/:id/desbloquear` | `USUARIOS_GESTIONAR` | Quita el bloqueo por contraseñas incorrectas sin cambiar la contraseña |
| `POST /api/usuarios/:id/reiniciar-pin` | `USUARIOS_GESTIONAR` | Deja al usuario sin PIN (y sin su bloqueo): crea otro entrando con su contraseña |
| `POST /api/usuarios/:id/cerrar-sesiones` | `USUARIOS_GESTIONAR` | Cierra las sesiones abiertas del usuario |
| `GET /api/roles` | `USUARIOS_VER` | Roles con sus permisos (el ADMIN los tiene todos y no es editable) |
| `GET /api/permisos` | `ROLES_GESTIONAR` | Catálogo de permisos por módulo |
| `POST /api/roles` · `PUT /api/roles/:codigo` · `DELETE /api/roles/:codigo` | `ROLES_GESTIONAR` | Crea un rol (sin permisos), cambia su nombre o lo elimina (si no es de sistema ni tiene usuarios) |
| `PUT /api/roles/:codigo/permisos` | `ROLES_GESTIONAR` | `{ permisos: [...] }`: la lista completa con la que queda el rol |
| `GET /api/equipos` | `SUCURSALES_GESTIONAR` | Equipos registrados, con su último uso y sesiones abiertas |
| `PUT /api/equipos/:id/activo` | `SUCURSALES_GESTIONAR` | `{ activo }`: desactivar un equipo cierra sus sesiones y ya nadie entra desde él |
| `GET /api/parametros` | `PARAMETROS_GESTIONAR` | Parámetros generales con su tipo (número, hora, opción, texto) |
| `PUT /api/parametros/:clave` | `PARAMETROS_GESTIONAR` | `{ valor }` (texto, número o `null` para dejarlo vacío) |
| `GET /api/alertas` | `ALERTAS_VER` | `?estado=pendientes\|atendidas\|todas&tipo=&sucursal_id=&limite=&antes_de=` → alertas del panel y `total_pendientes` |
| `GET /api/alertas/sucursal` | (sesión) | Los avisos para quienes trabajan en la sucursal (hoy: la devolución aprobada que venció). Mismos filtros; cada quien ve los de sus sucursales. No salen en el panel |
| `POST /api/alertas/:id/atender` | `ALERTAS_VER`, o trabajar en la sucursal si el aviso es para ella | Marca la alerta como atendida (lo decide la base: `fn_atender_alerta`) |
| `GET /api/sucursales` | (sesión) | Ubicaciones donde el usuario puede operar, con sus cajas (para los formularios) |
| `POST /api/sucursales` · `PUT /api/sucursales/:id` · `PUT /api/sucursales/:id/activa` | `SUCURSALES_GESTIONAR` | `{ codigo, nombre, direccion, telefono }`. No se desactiva con existencias, turno abierto o envíos en tránsito |
| `POST /api/sucursales/:id/cajas` · `PUT /api/cajas/:id` · `PUT /api/cajas/:id/activa` | `SUCURSALES_GESTIONAR` | Cajas de una sucursal: `{ nombre }` |
| `GET /api/auditoria/cambios` | `AUDITORIA_VER` | `?tabla=&registro_id=&usuario_id=&accion=&desde=&hasta=&limite=&antes_de=` → quién cambió qué (antes y después) |
| `GET /api/auditoria/accesos` | `AUDITORIA_VER` | `?usuario_id=&username=&exito=&desde=&hasta=&limite=&antes_de=` → inicios de sesión exitosos y fallidos |

### Catálogo

Consultar pide `PRODUCTOS_VER` (lo tienen todos los roles). Cambiar el catálogo pide `PRODUCTOS_GESTIONAR`
y tocar precios o costos, `PRECIOS_EDITAR`. Los montos se envían como número o texto con hasta 2 decimales
y se devuelven como texto exacto (`"650.00"`). El **costo** solo lo ve quien tiene `REPORTES_COSTOS`
(para los demás llega `null`).

| Ruta | Qué hace |
|---|---|
| `GET /api/categorias` · `POST` · `PUT /:id` · `PUT /:id/activa` | Categorías: `{ nombre, descripcion }`. "Perforaciones" es del sistema |
| `PUT /api/categorias/:id/admite-devolucion` | `{ admite_devolucion }`: la casilla de si lo vendido de la categoría se puede devolver o cambiar. Solo con `DEVOLUCIONES_APROBAR` (el administrador); una categoría nueva nace sin ella |
| `GET /api/gamas` · `POST` · `PUT /:id` · `PUT /:id/activa` | Gamas de pieza: `{ nombre, modo_precio: TABLA/PIEZA, orden }`. Una gama en uso no cambia de modo |
| `GET /api/productos` | `?buscar=&categoria_id=&tipo=&estado=activos\|inactivos\|todos&limite=&desplazamiento=` → `{ productos, total }`, cada producto con sus variantes. Busca por nombre, SKU o código de barras |
| `GET /api/productos/:id` | Un producto con sus variantes |
| `POST /api/productos` | `{ categoria_id, nombre, descripcion, variantes: [...] }`: crea el producto con sus variantes (todo o nada) |
| `PUT /api/productos/:id` · `PUT /api/productos/:id/activo` | Edita o desactiva (no se desactiva con existencias) |
| `POST /api/productos/:id/variantes` | `{ sku, nombre, precio_venta, costo, codigo_barras, gama_id, atributos, foto_url }` |
| `PUT /api/variantes/:id` | Edita la variante (sin precio): `{ sku, nombre, codigo_barras, gama_id, atributos, foto_url }` |
| `PUT /api/variantes/:id/precio` | `{ precio_venta, costo }`: lo que no se envía no cambia; queda en el historial de precios |
| `PUT /api/variantes/:id/activo` | Desactiva o reactiva (no se desactiva con existencias) |
| `POST /api/variantes/:id/foto` · `DELETE /api/variantes/:id/foto` | Sube la foto de la variante (formulario multipart, campo `foto`: JPG, PNG o WebP de hasta 5 MB) o la quita |
| `POST /api/fotos` · `GET /api/fotos/:archivo` | Sube una imagen suelta (p. ej. la de una merma) y devuelve su `foto_url`; la imagen se sirve sin sesión |
| `GET /api/variantes/:id/historial-precios` | Cambios de precio y costo de la variante, con quién los hizo |
| `GET /api/variantes/buscar?texto=&sucursal_id=&limite=` | Búsqueda de la pantalla de venta: por nombre, SKU o código de barras, con precio y stock de la sucursal |
| `GET /api/variantes/:id/existencias` | Cuánto hay de la variante en cada ubicación (`INVENTARIO_VER`) |
| `GET /api/perforaciones` · `GET /:id` | Perforaciones con su precio de solo servicio, tabla por gama, precios especiales y piezas permitidas |
| `POST /api/perforaciones` | `{ codigo, nombre, precio_servicio, piezas_por_paquete }`: crea también sus entradas `SRV-código` y `PAQ-código` |
| `PUT /api/perforaciones/:id` · `/activa` · `/precio-servicio` | Nombre y piezas del paquete · activar o desactivar · precio de solo servicio |
| `PUT /api/perforaciones/:id/precios-gama` | `{ gama_id, precio }`: tabla perforación × gama (`null` quita el precio) |
| `PUT /api/perforaciones/:id/precios-especiales` | `{ variante_id o gama_id, precio, motivo }`: excepción que gana a la tabla (`null` la quita) |
| `PUT /api/perforaciones/:id/piezas-permitidas` | `{ gama_id o categoria_id o variante_id, permitir }`: qué piezas admite el paquete |
| `GET /api/perforaciones/:id/precio-paquete?piezas=12,15` | Precio del paquete con esas piezas y la regla aplicada (`ESPECIAL`, `TABLA_GAMA`, `SERVICIO_MAS_PIEZA`) |
| `GET /api/promociones` · `POST` · `PUT /:id` · `PUT /:id/activa` | Promociones (`PROMOCIONES_GESTIONAR`): `{ nombre, tipo: PORCENTAJE/MONTO, valor, compra_minima, vigente_desde, vigente_hasta, descripcion }`; nacen inactivas |
| `GET /api/promociones/disponibles?subtotal=` | Las que el POS puede aplicar hoy y cuánto rebajan (`VENTAS_PROMOCION`) |

### Inventario

Toda la mercadería entra por la bodega central (una compra o una entrada directa) y llega a las sucursales con
envíos en dos pasos. Cada quien ve los envíos, mermas, conteos y movimientos de **sus** sucursales; de la
bodega, quien no tiene `INVENTARIO_VER_BODEGA` solo sabe si hay o no (parámetro `BODEGA_VISIBILIDAD`).

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/proveedores` · `POST` · `PUT /:id` · `PUT /:id/activo` | `INVENTARIO_ENTRADA` | Proveedores: `{ nombre, pais, moneda_habitual, contacto, telefono, email }` |
| `GET /api/compras` · `GET /api/compras/:id` | `INVENTARIO_ENTRADA` | Compras con sus totales; el detalle trae las líneas (en borrador, con la vista previa del costeo) y los gastos |
| `POST /api/compras` · `PUT /api/compras/:id` | `INVENTARIO_ENTRADA` | `{ proveedor_id, factura_numero, fecha_factura, moneda, tipo_cambio, notas, lineas, gastos }`: queda en borrador |
| `PUT /api/compras/:id/lineas` · `DELETE /api/compras/:id/lineas/:varianteId` | `INVENTARIO_ENTRADA` | `{ variante_id, cantidad_facturada, costo_unitario, cantidad_recibida }` |
| `POST /api/compras/:id/gastos` · `DELETE /api/compras/:id/gastos/:gastoId` | `INVENTARIO_ENTRADA` | Gastos de importación: `{ concepto, moneda, monto, descripcion, tipo_cambio }` |
| `POST /api/compras/:id/confirmar` · `POST /api/compras/:id/cancelar` | `INVENTARIO_ENTRADA` | Confirmar entra el stock a la bodega con su costo prorrateado; cancelar pide `{ motivo }` |
| `GET /api/envios` · `GET /api/envios/:id` | `INVENTARIO_TRASLADAR` o `INVENTARIO_RECIBIR` | `?estado=&origen_id=&destino_id=&limite=&antes_de=` |
| `GET /api/envios/sugerencia?variante_id=&cantidad=` | `INVENTARIO_TRASLADAR` | Cuánto mandar a cada sucursal (stock mínimo primero, luego según ventas) |
| `POST /api/envios` · `PUT /api/envios/:id/lineas` | `INVENTARIO_TRASLADAR` | `{ origen_id, destino_id, notas, lineas }` · `{ variante_id, cantidad }` (0 quita la pieza) |
| `POST /api/envios/:id/enviar` · `POST /api/envios/:id/cancelar` | `INVENTARIO_TRASLADAR` | Enviar saca la mercadería del origen; solo un borrador se cancela |
| `POST /api/envios/:id/recibir` | `INVENTARIO_RECIBIR` | `{ recibido: [{ variante_id, cantidad }] }`: entra lo escaneado; si falta algo, alerta |
| `GET /api/mermas` · `POST /api/mermas` | `INVENTARIO_REPORTAR_MERMA` | `{ sucursal_id, variante_id, cantidad, motivo, foto_url }`: reportar no descuenta |
| `POST /api/mermas/:id/resolver` | `INVENTARIO_AJUSTAR` | `{ aprobar, comentario }`: aprobar descuenta la pieza |
| `GET /api/conteos` · `GET /api/conteos/:id` · `POST /api/conteos` | `INVENTARIO_CONTAR` | `{ sucursal_id, categoria_id, notas }`. Quien cuenta no ve el stock del sistema |
| `POST /api/conteos/:id/registrar` · `/enviar` · `/cancelar` | `INVENTARIO_CONTAR` | `{ variante_id, cantidad, sumar }`: cada escaneo suma una pieza |
| `GET /api/conteos/:id/diferencias` · `POST /api/conteos/:id/aplicar` | `INVENTARIO_AJUSTAR` | El admin compara lo contado con el sistema y convierte las diferencias en ajustes |
| `GET /api/inventario/existencias` | `INVENTARIO_VER` | `?sucursal_id=&buscar=&categoria_id=&solo_bajo_minimo=&limite=&desplazamiento=` |
| `GET /api/inventario/movimientos` | `INVENTARIO_VER` | El kardex: `?sucursal_id=&variante_id=&tipo=&desde=&hasta=&limite=&antes_de=` |
| `POST /api/inventario/movimientos` | `INVENTARIO_ENTRADA` o `INVENTARIO_AJUSTAR` | Entrada directa a la bodega, ajuste o merma directa: `{ sucursal_id, variante_id, tipo, cantidad, motivo, costo_unitario }` |
| `PUT /api/inventario/stock-minimo` | `INVENTARIO_AJUSTAR` | `{ sucursal_id, variante_id, stock_minimo }` |

### POS y caja

La sucursal, la caja y el turno **no vienen en la solicitud**: salen del equipo registrado donde se inició la
sesión. Una PC de caja trabaja con su caja; una tablet, con la única caja abierta de su sucursal. Solo el
administrador, cuando su equipo no tiene caja (o entra sin equipo registrado), indica `caja_id`.

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/caja/turno` | `CAJA_ABRIR`, `CAJA_CERRAR` o `VENTAS_REGISTRAR` | El turno abierto de la caja (`turno: null` si está cerrada). Sin montos. Solo desde un equipo registrado |
| `GET /api/caja/abiertas` | `VENTAS_REGISTRAR` | Las cajas con turno abierto de las sucursales de quien pregunta: dónde entra una venta hecha desde el celular |
| `POST /api/caja/turno/abrir` | `CAJA_ABRIR` | `{ inicial_nio, inicial_usd }`: el efectivo contado al abrir, sin ver el fondo esperado |
| `GET` · `POST /api/caja/turno/movimientos` | `CAJA_MOVIMIENTOS` | Ingresos y egresos de efectivo: `{ tipo, moneda, monto, motivo }` |
| `POST /api/caja/turno/cerrar` | `CAJA_CERRAR` | Arqueo ciego: `{ efectivo: [{ moneda, valor, cantidad }], no_efectivo: [{ metodo, monto }], retiro_nio, retiro_usd, justificacion, observaciones }` → ticket de cierre |
| `GET /api/turnos` · `GET /api/turnos/:id` | `CAJA_VER_DIFERENCIAS` | Historial con lo esperado, lo contado y las diferencias: `?sucursal_id=&estado=&desde=&hasta=&limite=&antes_de=` |
| `GET /api/turnos/:id/ticket` | `CAJA_CERRAR` o `CAJA_VER_DIFERENCIAS` | Los datos del ticket de cierre |
| `POST /api/turnos/:id/imprimir` | `CAJA_CERRAR` o `CAJA_VER_DIFERENCIAS` | El ticket de cierre en PDF de 80 mm |
| `POST /api/turnos/:id/cierre-forzado` | `CAJA_CIERRE_FORZADO` | `{ motivo }`: el admin cierra sin arqueo un turno que nadie cerró |
| `POST /api/ventas` | `VENTAS_REGISTRAR` | `{ clave_idempotencia, items: [{ variante_id, cantidad, precio, piezas }], pagos: [{ metodo, moneda, monto, referencia }], promocion_id, cliente_nombre, cliente_telefono, notas }` → la venta, con lo que va en el ticket |
| `GET /api/ventas` · `GET /api/ventas/:id` | `VENTAS_VER_PROPIAS` o `VENTAS_VER_TODAS` | Con `VENTAS_VER_TODAS`, las de sus sucursales; si no, solo las propias: `?sucursal_id=&turno_id=&vendedor_id=&estado=&desde=&hasta=&buscar=&limite=&antes_de=` |
| `POST /api/ventas/:id/anular` | `VENTAS_ANULAR` | `{ motivo }`: solo con el turno abierto; devuelve las piezas al inventario |
| `POST /api/ventas/:id/imprimir` | `VENTAS_VER_PROPIAS` o `VENTAS_VER_TODAS` | El ticket de la venta en PDF de 80 mm |
| `GET /api/tipo-cambio` | (cualquier usuario) | Córdobas por dólar vigentes |
| `PUT /api/tipo-cambio` | `TIPO_CAMBIO_GESTIONAR` | `{ usd_a_nio, confirmar }`: registra o corrige el de hoy (los días anteriores no se editan) |
| `GET /api/tipo-cambio/historial` | `TIPO_CAMBIO_GESTIONAR` | Los registrados, un día por fila del más reciente al más antiguo, con quién dejó cada valor y, en `registros`, todo lo que se registró ese día (el primero y sus correcciones): `?desde=&hasta=&limite=` |
| `GET /api/metodos-pago` · `GET /api/denominaciones` | (cualquier usuario) | Para armar las pantallas de cobro y de conteo |

- **Venta.** El precio de lista lo pone la base; `precio` solo sirve para cobrar más (`VENTAS_MODIFICAR_PRECIO`, hasta
  el tope del parámetro) y la única rebaja es una promoción (`VENTAS_PROMOCION`). Un paquete lleva cantidad 1 y las
  `piezas` escaneadas. El vuelto lo calcula la base. Sin turno abierto → 409 `SIN_TURNO_ABIERTO`.
- **Sin duplicados.** `clave_idempotencia` es un UUID que el POS genera para cada venta. Si la solicitud llega dos
  veces (doble clic, reintento de red) responde 200 con la misma venta y `repetida: true`; la primera vez, 201. La
  clave de otra persona o de otro turno → 409 `CLAVE_REUTILIZADA`. El número de factura no deja saltos.
- **Arqueo ciego.** Quien abre o cierra nunca recibe el monto esperado ni la diferencia. Si el conteo no cuadra por
  más de la tolerancia → 422 `CONTEO_NO_CUADRA` (sin montos) y queda **un solo reconteo**: el siguiente intento debe
  llevar `justificacion` (mínimo 10 caracteres) y la caja se cierra con lo contado, con alerta al administrador.
- **Ticket de cierre.** Quien cierra recibe lo que contó, lo que retiró y el fondo que dejó. Lo vendido y lo cobrado
  por método solo llegan con `CAJA_VER_DIFERENCIAS`; lo esperado y las diferencias, solo en `/api/turnos`.
- **Ticket de venta.** La venta trae `ticket: { negocio, ruc, direccion, telefono, leyenda, qr }` (parámetros
  `NEGOCIO_NOMBRE`, `NEGOCIO_RUC` y `TICKET_LEYENDA`, más los datos de la sucursal) para que la pantalla lo imprima.
  `qr` es el texto del código QR del pie: el número de factura, para escanearlo si el cliente vuelve a devolver o
  cambiar algo (el PDF ya lo dibuja; una venta anulada no lo lleva).
- **Tickets en PDF.** `POST /api/ventas/:id/imprimir` y `POST /api/turnos/:id/imprimir` devuelven el ticket como
  PDF de una sola página de 80 mm de ancho (impresora térmica). Cada impresión queda anotada: la primera es el
  original y las siguientes llevan la palabra **COPIA**; la cabecera `X-Ticket-Impresion` dice cuál es (1, 2, 3…).
  El de cierre sale reducido o completo según el permiso, igual que su versión en datos.
- **Tipo de cambio.** Si el valor se aleja del último registrado más que el parámetro `TIPO_CAMBIO_VARIACION_MAX`
  (5 %) → 409 `CONFIRMACION_REQUERIDA`: la pantalla muestra el mensaje, pregunta y lo reenvía con `confirmar: true`.
  El primero que se registra (sin uno anterior) debe estar entre 20 y 60 córdobas por dólar; fuera de ese rango
  responde 422 aunque venga confirmado.

### Devoluciones y cambios

Para ventas de un turno **ya cerrado** (con el turno abierto, la venta se anula). Son tres pasos: la sucursal la
solicita, el administrador la aprueba o la rechaza, y ya aprobada se ejecuta en la caja abierta de la sucursal
donde está el cliente, que puede ser otra que la de la venta. La factura original nunca se modifica.

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/devoluciones/venta?numero=` | `DEVOLUCIONES_REGISTRAR` o `DEVOLUCIONES_APROBAR` | Busca la factura por su número (el QR del ticket; `lam-12` también vale), de la sucursal que sea: qué líneas se pueden devolver, cuántas quedan, lo pagado por unidad y las solicitudes que ya tiene |
| `POST /api/devoluciones` | `DEVOLUCIONES_REGISTRAR` | 1) La solicitud: `{ venta_id, tipo: DEVOLUCION/CAMBIO, motivo, cliente_nombre, cliente_telefono, lineas: [{ detalle_id, cantidad, estado: BUENO/DEFECTUOSO }] }`. Queda pendiente, aparta lo pedido y deja una alerta al administrador |
| `GET /api/devoluciones` · `GET /api/devoluciones/:id` | `DEVOLUCIONES_REGISTRAR` o `DEVOLUCIONES_APROBAR` | `?estado=&tipo=&sucursal_id=&desde=&hasta=&por_transferir=&buscar=&limite=&antes_de=` |
| `POST /api/devoluciones/:id/resolver` | `DEVOLUCIONES_APROBAR` | 2) `{ aprobar, comentario }`: solo el administrador. Para rechazar, el comentario es obligatorio |
| `POST /api/devoluciones/:id/cancelar` | `DEVOLUCIONES_REGISTRAR` o `DEVOLUCIONES_APROBAR` | `{ motivo }`: mientras no se haya ejecutado; quien la solicitó o el administrador |
| `POST /api/devoluciones/:id/ejecutar` | `DEVOLUCIONES_REGISTRAR` | 3) En el turno abierto de la caja de la sesión. Devolución: `{}`. Cambio: `{ clave_idempotencia, items, pagos, notas }`, como una venta |
| `POST /api/devoluciones/:id/transferencia` | `DEVOLUCIONES_APROBAR` | `{ referencia }`: el administrador anota la transferencia de lo que no salió de la caja |
| `POST /api/devoluciones/:id/imprimir` | `DEVOLUCIONES_REGISTRAR` o `DEVOLUCIONES_APROBAR` | El ticket de la devolución en PDF de 80 mm, con la firma del cliente (la reimpresión lleva COPIA) |

- **Qué se devuelve.** Solo artículos con stock de una categoría con la casilla «admite devolución»: nunca piezas de
  piercing, perforaciones ni paquetes. Por línea y cantidad, sin pasar de lo vendido menos lo ya devuelto y lo
  apartado en otras solicitudes. Plazo: `DEVOLUCION_DIAS_MAX` (7) días calendario desde la venta, contados al
  crear la solicitud.
- **Monto.** Lo que de verdad se pagó por esas unidades, con la promoción descontada en proporción, en córdobas. El
  reparto no pierde centavos: devuelta por partes, una factura devuelve exactamente lo que se pagó por ella.
- **Aprobada.** Tiene `DEVOLUCION_APROBADA_DIAS` (3) días para ejecutarse (`vence_el`); después la tarea programada
  la cancela sola y libera lo apartado. Aprobada, la puede ver y ejecutar cualquier sucursal.
- **Reembolso según cómo se pagó la factura** (`reembolso: { saldo, efectivo, transferencia, definitivo }`): la
  parte pagada en efectivo (córdobas o dólares) sale en córdobas de la caja del turno y cuenta en el arqueo; la
  parte pagada con tarjeta o transferencia la transfiere el administrador (`por_transferir`, con alerta), queda con
  su referencia y no pasa por la caja. Antes de ejecutar una devolución es lo previsto (`definitivo: false`).
- **Cambio.** Es una venta nueva (sin promoción) en la que lo devuelto entra como el pago «Saldo por cambio». Si lo
  nuevo cuesta más, la diferencia se paga con los métodos normales; si cuesta menos, lo que sobra se reembolsa como
  en una devolución. Esa venta no se anula; lo comprado en ella se puede devolver después. Reintentar con la misma
  `clave_idempotencia` responde lo mismo con `repetida: true`.
- **Inventario.** Lo devuelto entra al stock de la sucursal donde se ejecuta (movimiento `DEVOLUCION`, al costo con
  que se vendió); lo defectuoso sale enseguida como merma ya aprobada.
- **Número.** Cada devolución toma el suyo al ejecutarse, sin saltos: `DEV-<sucursal>-000001`.
- **Arqueo ciego.** La vendedora ve el monto de cada devolución (tiene que entregarlo), nunca sumas ni lo esperado.
  En el ticket de cierre, las devoluciones del turno y el efectivo que salió por ellas solo llegan con
  `CAJA_VER_DIFERENCIAS`.

### Reportes

Todos responden lo mismo: `{ reporte: { clave, titulo, desde, hasta, sucursal, generado_at, notas, secciones } }`,
donde cada sección es una tabla: `{ clave, titulo, columnas: [{ clave, titulo, tipo }], filas, totales }`. Con
`?formato=xlsx` o `?formato=pdf` entregan el mismo reporte como archivo (pide el mismo permiso).

| Ruta | Permiso | Qué trae |
|---|---|---|
| `GET /api/reportes/ventas` | `REPORTES_VER` | Ventas, unidades, descuentos, devoluciones, venta neta, sobreprecio y ticket promedio, una fila por día, semana o mes (`?agrupar=dia\|semana\|mes`) |
| `GET /api/reportes/ventas-por-vendedor` | `REPORTES_VER` | Lo mismo por persona, con las ventas que se le anularon |
| `GET /api/reportes/ventas-por-sucursal` | `REPORTES_VER` | Lo mismo por sucursal |
| `GET /api/reportes/cobros` | `REPORTES_VER` | El dinero que entró por método de pago y moneda (el vuelto ya restado; los dólares, con su equivalente) y, en negativo, lo devuelto en efectivo y por transferencia. El saldo por cambio no es dinero: no entra |
| `GET /api/reportes/devoluciones` | `REPORTES_VER` | Devoluciones y cambios ejecutados en el rango: resumen, cada una con su motivo y cómo se entregó (saldo, efectivo, transferencia y su referencia) y los productos devueltos con su estado. El nombre y el teléfono del cliente, solo con `DEVOLUCIONES_APROBAR` |
| `GET /api/reportes/productos` | `REPORTES_VER` | Los más vendidos (`?limite=`, por defecto 20) |
| `GET /api/reportes/perforaciones` | `REPORTES_VER` | Cada perforación: con pieza (paquete) contra solo servicio |
| `GET /api/reportes/gamas` | `REPORTES_VER` | Paquetes vendidos según la gama de la pieza |
| `GET /api/reportes/promociones` | `REPORTES_VER` | Ventas, rebaja y cobrado con cada promoción |
| `GET /api/reportes/sobreprecios` | `REPORTES_VER` | Cada línea cobrada por encima del precio establecido |
| `GET /api/reportes/piezas-en-paquetes` | `REPORTES_COSTOS` | Piezas que salieron del inventario dentro de paquetes (perforación con pieza), en total y por sucursal, con su costo |
| `GET /api/reportes/compras-por-proveedor` | `REPORTES_COSTOS` | Compras confirmadas por proveedor y moneda, por mes y una por una: piezas, faltantes, factura, gastos de importación y costo total. El rango va por la fecha de la factura; no lleva `sucursal_id` |
| `GET /api/reportes/cierres` | `CAJA_VER_DIFERENCIAS` | Turnos cerrados en el rango: esperado, contado, diferencia, reconteo, cierre forzado y justificación |
| `GET /api/reportes/mermas` | `REPORTES_VER` | Mermas aprobadas (al costo de cuando se aprobaron); pendientes y rechazadas, aparte |
| `GET /api/reportes/inventario-valorizado` | `REPORTES_COSTOS` | Unidades, valor a costo y a precio de venta por ubicación y categoría: el de hoy o, con `?mes=AAAA-MM`, la foto del cierre de ese mes (`/meses` lista los que tienen foto) |
| `GET /api/reportes/por-reponer` | `REPORTES_VER` | Lo que está en su stock mínimo o por debajo |

- **Rango.** `?periodo=dia|semana|mes` y, si se quiere, `&fecha=AAAA-MM-DD` (un día de ese periodo): el reporte
  diario, el semanal (de lunes a domingo) y el mensual. O `?desde=&hasta=` para un rango cualquiera de hasta 366
  días. Sin nada, el día de hoy. Los días son los de Managua. Además `?sucursal_id=`.
- **Qué ve cada quien.** Solo sus sucursales (una ajena responde 404). El costo, el margen y el valor a costo solo
  salen con `REPORTES_COSTOS` (solo el administrador): sin él esas columnas no existen, ni en el JSON ni en el
  archivo. El vendedor no tiene `REPORTES_VER`.
- **Arqueo ciego.** Sin `CAJA_VER_DIFERENCIAS`, los reportes de ventas y de cobros no incluyen las ventas ni las
  devoluciones de un turno que sigue abierto (con ellas se deduciría lo esperado en caja); el reporte lo avisa en
  `notas`.
- **Ventas netas.** Los reportes de ventas restan lo devuelto (unidades, venta neta, costo y margen) y lo muestran
  en la columna «Devoluciones». La devolución resta el día en que se ejecutó, a quien hizo la venta original y a
  su sucursal, aunque se haya ejecutado en otra; el dinero (reporte de cobros), en cambio, sale de la sucursal
  donde se ejecutó. El número de ventas no baja: devolver no borra la factura. Lo devuelto defectuoso aparece
  además en el reporte de mermas.
- **Montos y fechas.** Como en el resto de la API: los montos son texto con 2 decimales y las fechas con hora,
  instantes ISO. En Excel van como números y fechas; el PDF es tamaño carta (horizontal si la tabla es ancha).

### Tareas programadas

Al arrancar y cada 15 minutos el servidor corre tres funciones de la base (`TAREAS_PROGRAMADAS=false` lo apaga):

- `fn_alertar_cajas_sin_cerrar`: una alerta por cada caja que sigue abierta después de la hora del parámetro
  `CAJA_HORA_ALERTA_CIERRE` (21:30) o desde un día anterior. Al cerrar la caja la alerta queda atendida.
- `fn_foto_inventario_mensual`: la primera vez que corre en un mes nuevo guarda la foto del inventario valorizado
  del mes que acaba de cerrar. Las cantidades salen del kardex (son las del cierre aunque el servidor haya estado
  apagado ese día); el costo y el precio de venta son los del momento en que se toma.
- `fn_vencer_devoluciones`: cancela las devoluciones aprobadas que no se ejecutaron dentro de su plazo
  (`DEVOLUCION_APROBADA_DIAS`) y libera lo que tenían apartado. Por cada una deja dos alertas
  `DEVOLUCION_VENCIDA`: una en el panel del administrador y otra para la sucursal que la solicitó.

Las alertas se ven en el panel (`GET /api/alertas`, `ALERTAS_VER`). Además de las anteriores, desde B7 hay una
cuando alguien confirma un tipo de cambio fuera del límite (`TIPO_CAMBIO_FUERA_LIMITE`).

Una alerta marcada `para_sucursal` es un aviso para quienes trabajan en esa sucursal: no sale en el panel y se
consulta en `GET /api/alertas/sucursal`, sin permiso especial. El panel y la sucursal tienen cada uno su alerta
y cada quien atiende la suya (que la vendedora marque la suya como vista no le quita la suya al administrador).
Un aviso para la sucursal no lleva montos.

### Carga inicial desde Excel

`POST /api/carga-inicial` (formulario multipart, campo `archivo`) recibe `docs/plantilla-carga-inicial.xlsx` ya llena
y crea categorías, perforaciones con sus precios, productos, inventario inicial, proveedores, usuarios y promociones.

- Sin parámetros **simula**: responde qué se crearía, los avisos y los errores de cada hoja y fila, y no guarda nada.
- Con `?aplicar=true` guarda todo en una sola transacción; si hay un solo error no guarda nada (422 con el informe).
- Solo crea lo que falta: lo que ya existe se omite con un aviso, así el mismo archivo se puede volver a cargar.
- Los precios sí quedan como diga el archivo: la tabla de paquetes, los precios especiales, el precio de solo
  servicio de las perforaciones que ya existen y el precio de venta de los productos que ya existen (pide
  `PRECIOS_EDITAR`; el cambio queda en el historial de precios y el aviso de la fila dice el precio anterior y el
  nuevo; se cuentan en `resumen.precios_servicio_actualizados` y `resumen.precios_actualizados`). El costo, el
  inventario y los demás datos de esos productos y perforaciones no cambian.
- Una perforación o un producto que ya existe y viene dos veces en el archivo es un error.
- La respuesta trae las contraseñas temporales de los usuarios creados (se muestran una sola vez).
