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
db/04_pruebas.sql      221 pruebas de reglas de negocio
db/scripts/probar.sh   Recrea la BD esmeralda_test y corre todas las pruebas
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
  `db/04_pruebas.sql` y correr `bash db/scripts/probar.sh` hasta ver `*** TODAS LAS PRUEBAS PASARON ***`.
  (La línea `ERROR: Venta LBR-MANUAL...` es esperada: prueba un trigger diferido.)

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

Documentos de referencia (claude.ai): "Sistema Esmeralda — Documento de diseño" y
"Sistema Esmeralda — Resumen para la dirección".

## Siguiente etapa: backend

Stack: Node 22 + TypeScript, **NestJS**, **Kysely** + `pg` (consultas tipadas; llama a las `fn_*`),
Zod para validar entrada, argon2id para contraseñas, JWT de acceso (15 min) + refresh en cookie httpOnly
(hash SHA-256 en tabla `sesion`), pruebas con Jest + supertest contra una BD de prueba.

| Paso | Contenido |
|---|---|
| B1 | Proyecto base, conexión a PostgreSQL, configuración, transacción con `app.usuario_id` |
| B2 | Login, sesión renovable, bloqueo por intentos, cambio obligatorio de contraseña, registro de equipos |
| B3 | Panel admin: usuarios, roles/permisos, equipos, parámetros, alertas |
| B4 | Catálogo: productos, perforaciones, gamas, precios de paquetes, promociones |
| B5 | Inventario: compras, envíos/recepción, mermas, conteos |
| B6 | POS y caja: venta, cobro, apertura, cierre, ticket |
| B7 | Reportes, exportación (Excel/PDF), tarea programada `fn_alertar_cajas_sin_cerrar` |
