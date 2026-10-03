// Jest globalSetup: recrea la base de pruebas una vez por corrida y hace que todas las
// pruebas (y el AppModule que levantan) se conecten a ella.
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recrearBaseDatos, urlBdPrueba } from '../scripts/bd.mjs';

export default async function prepararBd() {
  const url = urlBdPrueba();
  await recrearBaseDatos(url, { log: () => {} });
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRETO = 'secreto-solo-para-pruebas-automaticas-0123456789';
  // Las pruebas inician muchas sesiones seguidas; el límite se prueba aparte con un valor bajo
  process.env.LOGIN_LIMITE_POR_MINUTO = '1000';
  // Las fotos que suben las pruebas van a una carpeta temporal, vacía en cada corrida
  const dirFotos = join(tmpdir(), 'esmeralda-fotos-test');
  rmSync(dirFotos, { recursive: true, force: true });
  process.env.DIR_FOTOS = dirFotos;
}
