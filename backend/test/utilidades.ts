import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { hashearPassword } from '../src/autenticacion/seguridad';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import { configurarApp } from '../src/configurar-app';

/** Levanta la API completa contra la base de pruebas (sin logs). */
export async function crearApp(
  opciones: {
    controladores?: Type[];
    configurar?: (constructor: TestingModuleBuilder) => void;
  } = {},
): Promise<NestExpressApplication> {
  const constructor = Test.createTestingModule({
    imports: [AppModule],
    controllers: opciones.controladores ?? [],
  });
  opciones.configurar?.(constructor);
  const modulo = await constructor.compile();
  const app = configurarApp(
    modulo.createNestApplication<NestExpressApplication>({ logger: false }),
  );
  await app.init();
  return app;
}

/**
 * Crea un usuario con contraseña definitiva usando las funciones de la base (como lo haría el
 * panel) y devuelve su id. Cada archivo e2e crea sus propios actores: así no depende de cómo
 * dejen a "admin" y a los usuarios demo las demás pruebas.
 */
export async function crearUsuarioDePrueba(
  app: NestExpressApplication,
  datos: { nombre: string; username: string; password: string; rol: string; sucursales?: number[] },
): Promise<number> {
  const bd = app.get(BaseDatosService);
  const admin = await bd.db
    .selectFrom('usuario')
    .select('id')
    .where('username', '=', 'admin')
    .executeTakeFirstOrThrow();
  const hash = await hashearPassword(datos.password);
  const id = await bd.transaccion(admin.id, async (trx) => {
    const { rows } = await sql<{ id: number }>`
      select fn_crear_usuario(${admin.id}, ${datos.nombre}, ${datos.username}, ${hash}, ${datos.rol},
             ${datos.sucursales ?? []}::integer[]) as id`.execute(trx);
    return rows[0].id;
  });
  // quita la obligación de cambiar la contraseña temporal
  await bd.transaccion(id, (trx) => sql`select fn_cambiar_password(${id}, ${hash})`.execute(trx));
  return id;
}

/** Inicia sesión (desde un equipo registrado, si se da su token) y devuelve el token de acceso. */
export async function tokenDeAcceso(
  app: NestExpressApplication,
  username: string,
  password: string,
  tokenEquipo?: string,
): Promise<string> {
  const solicitud = request(app.getHttpServer()).post('/api/auth/login');
  if (tokenEquipo) solicitud.set('Cookie', `esmeralda_equipo=${tokenEquipo}`);
  const respuesta = await solicitud.send({ username, password }).expect(200);
  return respuesta.body.access_token;
}

/** Registra una tablet en la sucursal (como admin) y devuelve el token que identifica al equipo. */
export async function registrarTablet(
  app: NestExpressApplication,
  accesoAdmin: string,
  nombre: string,
  sucursalId: number,
): Promise<string> {
  const respuesta = await request(app.getHttpServer())
    .post('/api/equipos')
    .set('Authorization', `Bearer ${accesoAdmin}`)
    .send({ nombre, tipo: 'TABLET', sucursal_id: sucursalId })
    .expect(201);
  return cookiePuesta(respuesta, 'esmeralda_equipo')?.valor ?? '';
}

/**
 * Para leer como bytes un archivo que la API entrega (Excel, PDF):
 * `request(http).get(ruta).buffer(true).parse(comoBytes)` deja el contenido en `body`.
 */
export function comoBytes(
  respuesta: Response,
  listo: (error: Error | null, cuerpo: Buffer) => void,
): void {
  const partes: Buffer[] = [];
  respuesta.on('data', (parte: Buffer) => partes.push(parte));
  respuesta.on('end', () => listo(null, Buffer.concat(partes)));
}

/** Una cookie que la respuesta pone con Set-Cookie: su valor y sus atributos (HttpOnly, Path...). */
export function cookiePuesta(
  respuesta: Response,
  nombre: string,
): { valor: string; atributos: string } | undefined {
  const lineas = ([] as string[]).concat(respuesta.headers['set-cookie'] ?? []);
  const linea = lineas.find((l) => l.startsWith(`${nombre}=`));
  if (!linea) return undefined;
  const [par, ...atributos] = linea.split(';');
  return {
    valor: decodeURIComponent(par.slice(nombre.length + 1)),
    atributos: atributos.map((a) => a.trim()).join('; '),
  };
}
