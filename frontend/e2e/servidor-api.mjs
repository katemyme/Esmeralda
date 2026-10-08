// Levanta el backend real para los recorridos de pantallas (Playwright), contra una base propia
// que se borra y se recrea en cada corrida (esmeralda_ui_test): no toca la base de desarrollo ni
// las de las otras pruebas. Corre en este mismo proceso: al terminar las pruebas no queda nada vivo.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recrearBaseDatos, urlBdPrueba } from '../../backend/scripts/bd.mjs';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
const PUERTO = process.env.PUERTO_API ?? '3100';

const url = new URL(urlBdPrueba());
url.pathname = '/esmeralda_ui_test';
await recrearBaseDatos(url.href, { log: () => {} });

const compilacion = spawnSync('npm', ['run', 'build'], {
  cwd: backend,
  stdio: 'inherit',
  shell: true,
});
if (compilacion.status !== 0) process.exit(compilacion.status ?? 1);

Object.assign(process.env, {
  DATABASE_URL: url.href,
  PORT: PUERTO,
  NODE_ENV: 'test',
  JWT_SECRETO: 'secreto-solo-para-los-recorridos-de-pantallas-0123456789',
  // los recorridos inician sesión muchas veces seguidas desde la misma IP
  LOGIN_LIMITE_POR_MINUTO: '1000',
  TAREAS_PROGRAMADAS: 'false',
});
process.chdir(backend);
await import(pathToFileURL(join(backend, 'dist', 'main.js')).href);
