# Sistema Esmeralda

Sistema web de inventario, ventas (POS) y caja para **Esmeralda Experience**:
dos sucursales (Multicentro Las Américas y Multicentro Las Brisas) y una bodega central.

## Estado

| Parte | Estado |
|---|---|
| Diseño funcional | Completo |
| Base de datos (PostgreSQL 16) | v1.1 completa y probada |
| Backend (Node + TypeScript, NestJS) | En desarrollo: B1 (base) y B2 (login, sesiones, equipos) listos |
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
