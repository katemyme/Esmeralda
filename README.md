# Sistema Esmeralda

Sistema web de inventario, ventas (POS) y caja para **Esmeralda Experience**:
dos sucursales (Multicentro Las Américas y Multicentro Las Brisas) y una bodega central.

## Estado

| Parte | Estado |
|---|---|
| Diseño funcional | Completo |
| Base de datos (PostgreSQL 16) | v1.1 completa y probada |
| Backend (Node + TypeScript, NestJS) | En desarrollo: B1 (base), B2 (login, sesiones, equipos) y B3 (panel de administración) listos |
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
  modelo-datos.html   Diagrama entidad-relación y reglas (v1.0)
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
3. Encargados y vendedores solo pueden entrar desde un equipo registrado de una de sus sucursales.
   La sesión dura 12 horas en un equipo registrado y 7 días sin equipo (solo el admin).

| Ruta | Qué hace |
|---|---|
| `POST /api/auth/login` | `{ username, password }` → token de acceso (15 min) + cookie de sesión |
| `POST /api/auth/refresh` | Renueva el token de acceso con la cookie (y la rota) |
| `POST /api/auth/logout` | Cierra la sesión |
| `GET /api/auth/yo` | Usuario, permisos, sucursales y equipo de la sesión |
| `POST /api/auth/cambiar-password` | `{ password_actual, password_nueva }` (mín. 8, con letras y números) |
| `POST /api/equipos` | Registra este equipo: `{ nombre, tipo: CAJA/TABLET/MOVIL, sucursal_id, caja_id }` |
| `GET /api/equipos/actual` | Qué equipo registrado es este navegador |

Las demás rutas exigen `Authorization: Bearer <token de acceso>`. Los errores responden
`{ codigo, mensaje }` en español (p. ej. `CREDENCIALES_INVALIDAS`, `CUENTA_BLOQUEADA`, `EQUIPO_NO_AUTORIZADO`).

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
| `POST /api/usuarios/:id/cerrar-sesiones` | `USUARIOS_GESTIONAR` | Cierra las sesiones abiertas del usuario |
| `GET /api/roles` | `USUARIOS_VER` | Roles con sus permisos (el ADMIN los tiene todos y no es editable) |
| `GET /api/permisos` | `ROLES_GESTIONAR` | Catálogo de permisos por módulo |
| `PUT /api/roles/:codigo/permisos` | `ROLES_GESTIONAR` | `{ permisos: [...] }`: la lista completa con la que queda el rol |
| `GET /api/equipos` | `SUCURSALES_GESTIONAR` | Equipos registrados, con su último uso y sesiones abiertas |
| `PUT /api/equipos/:id/activo` | `SUCURSALES_GESTIONAR` | `{ activo }`: desactivar un equipo cierra sus sesiones y ya nadie entra desde él |
| `GET /api/parametros` | `PARAMETROS_GESTIONAR` | Parámetros generales con su tipo (número, hora, opción, texto) |
| `PUT /api/parametros/:clave` | `PARAMETROS_GESTIONAR` | `{ valor }` (texto, número o `null` para dejarlo vacío) |
| `GET /api/alertas` | `ALERTAS_VER` | `?estado=pendientes\|atendidas\|todas&tipo=&sucursal_id=&limite=&antes_de=` → alertas y `total_pendientes` |
| `POST /api/alertas/:id/atender` | `ALERTAS_VER` | Marca la alerta como atendida |
| `GET /api/sucursales` | (sesión) | Ubicaciones donde el usuario puede operar, con sus cajas (para los formularios) |
