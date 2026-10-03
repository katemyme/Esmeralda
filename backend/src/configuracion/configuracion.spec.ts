import { isAbsolute, resolve } from 'node:path';
import { cargarConfiguracion, describirBaseDatos } from './configuracion';

const URL_VALIDA = 'postgres://postgres:secreta%40123@localhost:5432/esmeralda';
const SECRETO = 'x'.repeat(40);
const MINIMO = { DATABASE_URL: URL_VALIDA, JWT_SECRETO: SECRETO };

describe('cargarConfiguracion', () => {
  it('aplica los valores por defecto', () => {
    expect(cargarConfiguracion(MINIMO)).toEqual({
      entorno: 'development',
      puerto: 3000,
      baseDatos: { url: URL_VALIDA, maxConexiones: 10 },
      autenticacion: { secretoJwt: SECRETO, limiteLoginPorMinuto: 10, cookiesSeguras: false },
      trustProxy: false,
      dirFotos: resolve('almacen/fotos'),
    });
  });

  it('la carpeta de fotos queda como ruta absoluta', () => {
    const { dirFotos } = cargarConfiguracion({ ...MINIMO, DIR_FOTOS: ' datos/fotos ' });
    expect(dirFotos).toBe(resolve('datos/fotos'));
    expect(isAbsolute(dirFotos)).toBe(true);
  });

  it('convierte los números que llegan como texto', () => {
    const config = cargarConfiguracion({
      ...MINIMO,
      NODE_ENV: 'production',
      PORT: '8080',
      DB_POOL_MAX: '20',
      LOGIN_LIMITE_POR_MINUTO: '5',
    });
    expect(config.entorno).toBe('production');
    expect(config.puerto).toBe(8080);
    expect(config.baseDatos.maxConexiones).toBe(20);
    expect(config.autenticacion.limiteLoginPorMinuto).toBe(5);
  });

  it('en producción las cookies solo viajan por HTTPS', () => {
    expect(
      cargarConfiguracion({ ...MINIMO, NODE_ENV: 'production' }).autenticacion.cookiesSeguras,
    ).toBe(true);
  });

  it('acepta el esquema postgresql://', () => {
    expect(() =>
      cargarConfiguracion({ ...MINIMO, DATABASE_URL: 'postgresql://u@servidor:5432/esmeralda' }),
    ).not.toThrow();
  });

  it('exige DATABASE_URL', () => {
    expect(() => cargarConfiguracion({ JWT_SECRETO: SECRETO })).toThrow(
      /Configuración inválida[\s\S]*DATABASE_URL/,
    );
  });

  it('rechaza una URL que no es de PostgreSQL', () => {
    expect(() =>
      cargarConfiguracion({ ...MINIMO, DATABASE_URL: 'mysql://u@servidor/esmeralda' }),
    ).toThrow(/debe ser una URL postgres:\/\//);
  });

  it('rechaza un puerto inválido', () => {
    expect(() => cargarConfiguracion({ ...MINIMO, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => cargarConfiguracion({ ...MINIMO, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rechaza un entorno desconocido', () => {
    expect(() => cargarConfiguracion({ ...MINIMO, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('exige un secreto JWT de al menos 32 caracteres que no sea el de ejemplo', () => {
    expect(() => cargarConfiguracion({ DATABASE_URL: URL_VALIDA })).toThrow(/JWT_SECRETO/);
    expect(() => cargarConfiguracion({ ...MINIMO, JWT_SECRETO: 'corto' })).toThrow(
      /al menos 32 caracteres/,
    );
    expect(() =>
      cargarConfiguracion({
        ...MINIMO,
        JWT_SECRETO: 'CAMBIE_ESTE_VALOR_POR_EL_QUE_GENERA_npm_run_secreto',
      }),
    ).toThrow(/valor de ejemplo/);
  });

  it('interpreta TRUST_PROXY', () => {
    const trustProxy = (valor: string) =>
      cargarConfiguracion({ ...MINIMO, TRUST_PROXY: valor }).trustProxy;
    expect(trustProxy('false')).toBe(false);
    expect(trustProxy('true')).toBe(true);
    expect(trustProxy('1')).toBe(1);
    expect(trustProxy('loopback')).toBe('loopback');
  });
});

describe('describirBaseDatos', () => {
  it('no muestra usuario ni contraseña', () => {
    expect(describirBaseDatos(URL_VALIDA)).toBe('esmeralda en localhost:5432');
  });
});
