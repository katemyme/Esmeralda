# Sistema Esmeralda

Sistema web de inventario, ventas (POS) y caja para **Esmeralda Experience**:
dos sucursales (Multicentro Las Américas y Multicentro Las Brisas) y una bodega central.

## Estado

| Parte | Estado |
|---|---|
| Diseño funcional | Completo |
| Base de datos (PostgreSQL 16) | v1.1 completa y probada |
| Backend (Node + TypeScript, NestJS) | En desarrollo: B1 listo (base, conexión, configuración) |
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
cp .env.example .env     # Windows: copy .env.example .env — y complete DATABASE_URL
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
