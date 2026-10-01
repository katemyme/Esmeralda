/**
 * npm run db:recrear — borra y crea la base de desarrollo (DATABASE_URL de backend/.env)
 * con esquema + seed + datos demo. Solo para bases locales y nunca en producción.
 */
import { cargarEnv, nombreBase, recrearBaseDatos } from './bd.mjs';

const SERVIDORES_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);

function detener(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

cargarEnv();
const url = process.env.DATABASE_URL;
if (!url) detener('Falta DATABASE_URL en backend/.env (copie .env.example)');
if (process.env.NODE_ENV === 'production')
  detener('db:recrear no se permite con NODE_ENV=production');
if (!SERVIDORES_LOCALES.has(new URL(url).hostname)) {
  detener(
    `db:recrear solo trabaja con bases locales (DATABASE_URL apunta a ${new URL(url).hostname})`,
  );
}

try {
  await recrearBaseDatos(url);
} catch (error) {
  detener(error.message);
}
console.log(`\nBase ${nombreBase(url)} lista: esquema + seed + datos demo.`);
console.log('  Administrador: admin / Esmeralda#2026 (se pide cambiarla al entrar)');
console.log('  Demo: maria.lopez (encargada), ana.martinez y carlos.ruiz (vendedores) / Demo#2026');
