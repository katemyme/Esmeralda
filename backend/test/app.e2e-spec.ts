import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import { CONFIGURACION, cargarConfiguracion } from '../src/configuracion/configuracion';
import { configurarApp } from '../src/configurar-app';

/** Rutas solo para estas pruebas: disparan errores reales de la base a través de HTTP. */
@Controller('prueba')
class PruebaController {
  constructor(private readonly bd: BaseDatosService) {}

  @Get('permiso')
  permiso() {
    return this.bd.transaccion(null, (trx) =>
      sql`select fn_exigir_permiso((select id from usuario where username = 'ana.martinez'), 'USUARIOS_GESTIONAR')`.execute(
        trx,
      ),
    );
  }

  @Get('regla')
  regla() {
    return this.bd.transaccion(null, (trx) =>
      trx.deleteFrom('usuario').where('username', '=', 'carlos.ruiz').execute(),
    );
  }

  @Get('falla')
  falla(): never {
    throw new Error('detalle interno que no debe salir');
  }
}

async function crearApp(
  configurar?: (modulo: ReturnType<typeof Test.createTestingModule>) => void,
) {
  const constructor = Test.createTestingModule({
    imports: [AppModule],
    controllers: [PruebaController],
  });
  configurar?.(constructor);
  const modulo = await constructor.compile();
  const app = configurarApp(
    modulo.createNestApplication<NestExpressApplication>({ logger: false }),
  );
  await app.init();
  return app;
}

describe('API con base de datos', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await crearApp();
  });

  afterAll(() => app.close());

  it('GET /api/salud → 200 con la base conectada', async () => {
    await request(app.getHttpServer())
      .get('/api/salud')
      .expect(200)
      .expect({ estado: 'ok', baseDatos: 'ok' });
  });

  it('no anuncia la tecnología del servidor (sin X-Powered-By)', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/salud');
    expect(respuesta.headers['x-powered-by']).toBeUndefined();
  });

  it('las rutas viven bajo /api', async () => {
    await request(app.getHttpServer()).get('/salud').expect(404);
  });

  it('ruta inexistente → 404 en español', async () => {
    await request(app.getHttpServer())
      .get('/api/no-existe')
      .expect(404)
      .expect({ codigo: 'NO_ENCONTRADO', mensaje: 'No existe la ruta GET /api/no-existe' });
  });

  it('JSON mal formado → 400 en español', async () => {
    await request(app.getHttpServer())
      .post('/api/salud')
      .set('Content-Type', 'application/json')
      .send('{malo')
      .expect(400)
      .expect({
        codigo: 'SOLICITUD_INVALIDA',
        mensaje: 'El cuerpo de la solicitud no es un JSON válido',
      });
  });

  it('cuerpo demasiado grande → 413 en español', async () => {
    await request(app.getHttpServer())
      .post('/api/salud')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ relleno: 'x'.repeat(200_000) }))
      .expect(413)
      .expect({ codigo: 'SOLICITUD_MUY_GRANDE', mensaje: 'La solicitud es demasiado grande' });
  });

  it('permiso denegado por la base → 403 con el mensaje de la regla', async () => {
    await request(app.getHttpServer()).get('/api/prueba/permiso').expect(403).expect({
      codigo: 'PERMISO_DENEGADO',
      mensaje: 'Permiso denegado: se requiere USUARIOS_GESTIONAR',
    });
  });

  it('regla de negocio de la base → 422 con el mensaje de la regla', async () => {
    await request(app.getHttpServer()).get('/api/prueba/regla').expect(422).expect({
      codigo: 'REGLA_NEGOCIO',
      mensaje: 'Los usuarios no se eliminan: desactívelos (activo = false)',
    });
  });

  it('error inesperado → 500 genérico, sin detalles internos', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/prueba/falla').expect(500);
    expect(respuesta.body.codigo).toBe('ERROR_INTERNO');
    expect(JSON.stringify(respuesta.body)).not.toContain('detalle interno');
  });
});

describe('API sin base de datos', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const config = cargarConfiguracion();
    const sinServidor = new URL(config.baseDatos.url);
    sinServidor.port = '1'; // nadie escucha ahí: conexión rechazada
    app = await crearApp((constructor) =>
      constructor
        .overrideProvider(CONFIGURACION)
        .useValue({ ...config, baseDatos: { url: sinServidor.toString(), maxConexiones: 1 } }),
    );
  });

  afterAll(() => app.close());

  it('GET /api/salud → 503 indicando que falta la base', async () => {
    await request(app.getHttpServer()).get('/api/salud').expect(503).expect({
      codigo: 'BD_NO_DISPONIBLE',
      mensaje: 'La API funciona, pero no hay conexión con la base de datos',
    });
  });

  it('una operación que necesita la base → 503', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/prueba/permiso').expect(503);
    expect(respuesta.body.codigo).toBe('BD_NO_DISPONIBLE');
  });
});
