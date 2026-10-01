import { cargarConfiguracion, describirBaseDatos } from './configuracion';

const URL_VALIDA = 'postgres://postgres:secreta%40123@localhost:5432/esmeralda';

describe('cargarConfiguracion', () => {
  it('aplica los valores por defecto', () => {
    expect(cargarConfiguracion({ DATABASE_URL: URL_VALIDA })).toEqual({
      entorno: 'development',
      puerto: 3000,
      baseDatos: { url: URL_VALIDA, maxConexiones: 10 },
    });
  });

  it('convierte los números que llegan como texto', () => {
    const config = cargarConfiguracion({
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: URL_VALIDA,
      DB_POOL_MAX: '20',
    });
    expect(config.entorno).toBe('production');
    expect(config.puerto).toBe(8080);
    expect(config.baseDatos.maxConexiones).toBe(20);
  });

  it('acepta el esquema postgresql://', () => {
    expect(() =>
      cargarConfiguracion({ DATABASE_URL: 'postgresql://u@servidor:5432/esmeralda' }),
    ).not.toThrow();
  });

  it('exige DATABASE_URL', () => {
    expect(() => cargarConfiguracion({})).toThrow(/Configuración inválida[\s\S]*DATABASE_URL/);
  });

  it('rechaza una URL que no es de PostgreSQL', () => {
    expect(() => cargarConfiguracion({ DATABASE_URL: 'mysql://u@servidor/esmeralda' })).toThrow(
      /debe ser una URL postgres:\/\//,
    );
  });

  it('rechaza un puerto inválido', () => {
    expect(() => cargarConfiguracion({ DATABASE_URL: URL_VALIDA, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => cargarConfiguracion({ DATABASE_URL: URL_VALIDA, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rechaza un entorno desconocido', () => {
    expect(() => cargarConfiguracion({ DATABASE_URL: URL_VALIDA, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });
});

describe('describirBaseDatos', () => {
  it('no muestra usuario ni contraseña', () => {
    expect(describirBaseDatos(URL_VALIDA)).toBe('esmeralda en localhost:5432');
  });
});
