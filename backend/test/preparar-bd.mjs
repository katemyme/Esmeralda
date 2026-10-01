// Jest globalSetup: recrea la base de pruebas una vez por corrida y hace que todas las
// pruebas (y el AppModule que levantan) se conecten a ella.
import { recrearBaseDatos, urlBdPrueba } from '../scripts/bd.mjs';

export default async function prepararBd() {
  const url = urlBdPrueba();
  await recrearBaseDatos(url, { log: () => {} });
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRETO = 'secreto-solo-para-pruebas-automaticas-0123456789';
  // Las pruebas inician muchas sesiones seguidas; el límite se prueba aparte con un valor bajo
  process.env.LOGIN_LIMITE_POR_MINUTO = '1000';
}
