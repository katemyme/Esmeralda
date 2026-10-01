# Sistema Esmeralda

Sistema web de inventario, ventas (POS) y caja para **Esmeralda Experience**:
dos sucursales (Multicentro Las Américas y Multicentro Las Brisas) y una bodega central.

## Estado

| Parte | Estado |
|---|---|
| Diseño funcional | Completo |
| Base de datos (PostgreSQL 16) | v1.1 completa y probada |
| Backend (Node + TypeScript) | Pendiente |
| Frontend (React + Vite, PWA) | Pendiente |

## Estructura

```
db/
  01_esquema.sql      Tablas, reglas, funciones y vistas
  02_seed.sql         Datos iniciales: ubicaciones, roles, permisos, parámetros, gamas, admin
  03_datos_demo.sql   Datos de demostración (solo desarrollo)
  04_pruebas.sql      Pruebas de reglas de negocio
  scripts/probar.sh   Recrea la BD de prueba y ejecuta todas las pruebas
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
