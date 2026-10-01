// Jest globalSetup: recrea la base de pruebas una vez por corrida y hace que todas las
// pruebas (y el AppModule que levantan) se conecten a ella.
import { recrearBaseDatos, urlBdPrueba } from '../scripts/bd.mjs';

export default async function prepararBd() {
  const url = urlBdPrueba();
  await recrearBaseDatos(url, { log: () => {} });
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
}
