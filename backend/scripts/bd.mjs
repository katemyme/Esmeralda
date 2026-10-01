/**
 * Utilidades de base de datos para desarrollo y pruebas (no forman parte de la API).
 * Las usan scripts/recrear-bd.mjs (npm run db:recrear) y test/preparar-bd.mjs (Jest).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // backend/
const DIR_SQL = resolve(RAIZ, '..', 'db');
const ARCHIVOS_SQL = ['01_esquema.sql', '02_seed.sql', '03_datos_demo.sql'];
const BD_PRUEBA_POR_DEFECTO = 'esmeralda_api_test';

/** Carga backend/.env si existe. No pisa variables de entorno ya definidas. */
export function cargarEnv() {
  const archivo = join(RAIZ, '.env');
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/** Nombre de la base de datos de una URL postgres://... */
export function nombreBase(url) {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/**
 * URL de la base de pruebas: TEST_DATABASE_URL, o DATABASE_URL apuntando a esmeralda_api_test.
 * Esa base se borra en cada corrida, por eso su nombre debe terminar en _test.
 */
export function urlBdPrueba() {
  cargarEnv();
  const { TEST_DATABASE_URL, DATABASE_URL } = process.env;
  if (!TEST_DATABASE_URL && !DATABASE_URL) {
    throw new Error('Falta DATABASE_URL en backend/.env (copie .env.example)');
  }
  const url = new URL(TEST_DATABASE_URL ?? DATABASE_URL);
  if (!TEST_DATABASE_URL) url.pathname = `/${BD_PRUEBA_POR_DEFECTO}`;
  if (!nombreBase(url).endsWith('_test')) {
    throw new Error(
      `La base de pruebas debe terminar en _test (TEST_DATABASE_URL apunta a "${nombreBase(url)}")`,
    );
  }
  return url.toString();
}

/** Borra la base de la URL (si existe), la crea y carga esquema + seed + datos demo. */
export async function recrearBaseDatos(url, { log = console.log } = {}) {
  const nombre = nombreBase(url);
  if (!/^[a-z_][a-z0-9_]*$/.test(nombre)) throw new Error(`Nombre de base no válido: "${nombre}"`);

  const mantenimiento = new URL(url);
  mantenimiento.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: mantenimiento.toString() });
  await admin.connect();
  try {
    log(`Recreando la base ${nombre} en ${new URL(url).host} ...`);
    await admin.query(`drop database if exists ${nombre} with (force)`);
    await admin.query(`create database ${nombre}`);
  } finally {
    await admin.end();
  }

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    for (const archivo of ARCHIVOS_SQL) {
      log(`Cargando ${archivo} ...`);
      try {
        await cliente.query(readFileSync(join(DIR_SQL, archivo), 'utf8'));
      } catch (error) {
        throw new Error(`Error al cargar db/${archivo}: ${error.message}`, { cause: error });
      }
    }
  } finally {
    await cliente.end();
  }
}
