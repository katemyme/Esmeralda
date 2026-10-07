import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import { sha256 } from '../src/autenticacion/seguridad';
import type { ContenidoToken } from '../src/autenticacion/usuario-autenticado';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import { CONFIGURACION, cargarConfiguracion } from '../src/configuracion/configuracion';
import { cookiePuesta, crearApp } from './utilidades';

// Recorrido completo de B2 contra la base de pruebas (datos demo: admin / Esmeralda#2026;
// maria.lopez, ana.martinez y carlos.ruiz / Demo#2026). Las pruebas van en orden y comparten estado.

const HORA_MS = 60 * 60 * 1000;

function cercaDe(fechaIso: string, msDesdeAhora: number): boolean {
  return Math.abs(new Date(fechaIso).getTime() - (Date.now() + msDesdeAhora)) < 5 * 60 * 1000;
}

describe('Autenticación y equipos', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { admin: 0, carlos: 0, lam: 0, lbr: 0, cajaLam: 0 };
  // Lo que el "navegador" de cada prueba guarda entre solicitudes
  const admin = { acceso: '', sesion: '' };
  const ana = { acceso: '', sesion: '' };
  const equipos = { cajaLam: '', tabletLbr: '' };

  function login(username: string, password: string, tokenEquipo?: string) {
    const solicitud = request(http).post('/api/auth/login');
    if (tokenEquipo) solicitud.set('Cookie', `esmeralda_equipo=${tokenEquipo}`);
    return solicitud.send({ username, password });
  }

  function conSesion(metodo: 'get' | 'post', ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function refresh(tokenSesion: string) {
    return request(http).post('/api/auth/refresh').set('Cookie', `esmeralda_sesion=${tokenSesion}`);
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const id = async (consulta: ReturnType<typeof sql<{ id: number }>>) =>
      (await consulta.execute(bd.db)).rows[0].id;
    ids.admin = await id(sql`select id from usuario where username = 'admin'`);
    ids.carlos = await id(sql`select id from usuario where username = 'carlos.ruiz'`);
    ids.lam = await id(sql`select id from sucursal where codigo = 'LAM'`);
    ids.lbr = await id(sql`select id from sucursal where codigo = 'LBR'`);
    ids.cajaLam = await id(
      sql`select c.id from caja c join sucursal s on s.id = c.sucursal_id where s.codigo = 'LAM'`,
    );
  });

  afterAll(() => app.close());

  describe('login del admin con su contraseña temporal', () => {
    it('contraseña incorrecta → 401 con un mensaje que no dice qué falló', async () => {
      await login('admin', 'mala').expect(401).expect({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Usuario o contraseña incorrectos',
      });
    });

    it('usuario inexistente → exactamente la misma respuesta', async () => {
      await login('nadie', 'mala').expect(401).expect({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Usuario o contraseña incorrectos',
      });
    });

    it('datos incompletos → 400 con el error por campo', async () => {
      await request(http)
        .post('/api/auth/login')
        .send({ username: 'admin' })
        .expect(400)
        .expect({
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'Escriba su contraseña',
          errores: [{ campo: 'password', mensaje: 'Escriba su contraseña' }],
        });
    });

    it('login correcto (hash bcrypt del seed): token, cookie de sesión y 7 días sin equipo', async () => {
      const respuesta = await login(' Admin ', 'Esmeralda#2026').expect(200);
      const { body } = respuesta;
      expect(body).toMatchObject({
        token_type: 'Bearer',
        expira_en: 900,
        equipo: null,
        usuario: {
          id: ids.admin,
          username: 'admin',
          rol: { codigo: 'ADMIN', nombre: 'Administrador' },
          debe_cambiar_password: true,
        },
      });
      expect(body.usuario.permisos).toContain('SUCURSALES_GESTIONAR');
      // el admin las ve todas, por id (otras pruebas pueden haber creado más: van después)
      expect(body.usuario.sucursales.slice(0, 3).map((s: { codigo: string }) => s.codigo)).toEqual([
        'LAM',
        'LBR',
        'BOD',
      ]);
      expect(cercaDe(body.sesion_expira_at, 7 * 24 * HORA_MS)).toBe(true);

      const cookie = cookiePuesta(respuesta, 'esmeralda_sesion');
      expect(cookie?.atributos).toMatch(/Path=\/api\/auth/);
      expect(cookie?.atributos).toMatch(/HttpOnly/);
      expect(cookie?.atributos).toMatch(/SameSite=Strict/);
      expect(cookie?.atributos).not.toMatch(/Secure/); // solo en producción (HTTPS)
      admin.acceso = body.access_token;
      admin.sesion = cookie?.valor ?? '';
    });

    it('con la contraseña temporal puede ver sus datos, pero nada más', async () => {
      const yo = await conSesion('get', '/api/auth/yo', admin.acceso).expect(200);
      expect(yo.body.usuario.username).toBe('admin');
      await conSesion('post', '/api/equipos', admin.acceso)
        .send({ nombre: 'Caja', tipo: 'TABLET', sucursal_id: ids.lam })
        .expect(403)
        .expect({
          codigo: 'DEBE_CAMBIAR_PASSWORD',
          mensaje: 'Debe cambiar su contraseña temporal antes de continuar',
        });
    });

    it('el cambio valida la contraseña actual y la política de la nueva', async () => {
      const cambiar = (password_actual: string, password_nueva: string) =>
        conSesion('post', '/api/auth/cambiar-password', admin.acceso).send({
          password_actual,
          password_nueva,
        });
      await cambiar('mala', 'NuevaClave#2026').expect(422).expect({
        codigo: 'PASSWORD_ACTUAL_INCORRECTA',
        mensaje: 'La contraseña actual no es correcta',
      });
      const corta = await cambiar('Esmeralda#2026', 'abc1').expect(400);
      expect(corta.body.errores).toEqual([
        {
          campo: 'password_nueva',
          mensaje: 'La nueva contraseña debe tener al menos 8 caracteres',
        },
      ]);
      await cambiar('Esmeralda#2026', 'Esmeralda#2026').expect(422).expect({
        codigo: 'PASSWORD_REPETIDA',
        mensaje: 'La nueva contraseña debe ser distinta de la actual',
      });
      await cambiar('Esmeralda#2026', 'miadmin2026').expect(422).expect({
        codigo: 'PASSWORD_DEBIL',
        mensaje: 'La nueva contraseña no puede contener su nombre de usuario',
      });
    });

    it('cambio correcto: sesión nueva sin contraseña temporal; la anterior queda cerrada', async () => {
      const respuesta = await conSesion('post', '/api/auth/cambiar-password', admin.acceso)
        .send({ password_actual: 'Esmeralda#2026', password_nueva: 'NuevaClave#2026' })
        .expect(200);
      expect(respuesta.body.usuario.debe_cambiar_password).toBe(false);
      const sesionNueva = cookiePuesta(respuesta, 'esmeralda_sesion')?.valor ?? '';
      expect(sesionNueva).not.toBe(admin.sesion);

      await refresh(admin.sesion).expect(401); // la base cerró todas sus sesiones anteriores
      const fila = await bd.db
        .selectFrom('usuario')
        .select('password_hash')
        .where('id', '=', ids.admin)
        .executeTakeFirstOrThrow();
      expect(fila.password_hash).toMatch(/^\$argon2id\$/);
      admin.acceso = respuesta.body.access_token;
      admin.sesion = sesionNueva;
    });

    it('la contraseña nueva sirve para entrar; la temporal ya no', async () => {
      await login('admin', 'Esmeralda#2026').expect(401);
      const respuesta = await login('admin', 'NuevaClave#2026').expect(200);
      expect(respuesta.body.usuario.debe_cambiar_password).toBe(false);
    });
  });

  describe('registro de equipos', () => {
    it('una PC de caja debe indicar su caja', async () => {
      const respuesta = await conSesion('post', '/api/equipos', admin.acceso)
        .send({ nombre: 'Caja 1 Las Américas', tipo: 'CAJA', sucursal_id: ids.lam })
        .expect(400);
      expect(respuesta.body.errores[0].campo).toBe('caja_id');
    });

    it('la caja debe ser de la sucursal del equipo (regla de la base)', async () => {
      await conSesion('post', '/api/equipos', admin.acceso)
        .send({ nombre: 'Caja cruzada', tipo: 'CAJA', sucursal_id: ids.lbr, caja_id: ids.cajaLam })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La caja ${ids.cajaLam} no pertenece a la ubicación del equipo`,
        });
    });

    it('el admin registra la caja de Las Américas: el navegador recibe la cookie del equipo', async () => {
      const respuesta = await conSesion('post', '/api/equipos', admin.acceso)
        .send({
          nombre: ' Caja 1 Las Américas ',
          tipo: 'CAJA',
          sucursal_id: ids.lam,
          caja_id: ids.cajaLam,
        })
        .expect(201);
      expect(respuesta.body.equipo).toMatchObject({
        nombre: 'Caja 1 Las Américas',
        tipo: 'CAJA',
        caja_id: ids.cajaLam,
        sucursal: { id: ids.lam, codigo: 'LAM' },
      });
      const cookie = cookiePuesta(respuesta, 'esmeralda_equipo');
      expect(cookie?.atributos).toMatch(/Path=\/api;/);
      expect(cookie?.atributos).toMatch(/HttpOnly/);
      expect(cookie?.atributos).toMatch(/SameSite=Strict/);
      expect(cookie?.atributos).toMatch(/Max-Age=34560000/); // 400 días
      equipos.cajaLam = cookie?.valor ?? '';

      const guardado = await bd.db
        .selectFrom('dispositivo')
        .select(['token_hash', 'registrado_por'])
        .where('id', '=', respuesta.body.equipo.id)
        .executeTakeFirstOrThrow();
      expect(guardado).toEqual({ token_hash: sha256(equipos.cajaLam), registrado_por: ids.admin });
    });

    it('registra también la tablet de Las Brisas', async () => {
      const respuesta = await conSesion('post', '/api/equipos', admin.acceso)
        .send({ nombre: 'Tablet Las Brisas', tipo: 'TABLET', sucursal_id: ids.lbr })
        .expect(201);
      equipos.tabletLbr = cookiePuesta(respuesta, 'esmeralda_equipo')?.valor ?? '';
    });

    it('GET /api/equipos/actual dice qué equipo es este navegador', async () => {
      const actual = await request(http)
        .get('/api/equipos/actual')
        .set('Cookie', `esmeralda_equipo=${equipos.cajaLam}`)
        .expect(200);
      expect(actual.body.equipo.nombre).toBe('Caja 1 Las Américas');
      await request(http).get('/api/equipos/actual').expect(200).expect({ equipo: null });
      await request(http)
        .get('/api/equipos/actual')
        .set('Cookie', 'esmeralda_equipo=inventado')
        .expect(200)
        .expect({ equipo: null });
    });
  });

  describe('encargados y vendedores', () => {
    it('sin un equipo registrado no pueden entrar', async () => {
      await login('ana.martinez', 'Demo#2026').expect(403).expect({
        codigo: 'EQUIPO_NO_AUTORIZADO',
        mensaje: 'Solo puede iniciar sesión desde una caja o tablet registrada de su sucursal.',
      });
    });

    it('desde el equipo de otra sucursal tampoco', async () => {
      await login('ana.martinez', 'Demo#2026', equipos.tabletLbr).expect(403);
    });

    it('desde la caja de su sucursal: entra, con la sesión ligada al equipo por 12 horas', async () => {
      const respuesta = await login('ana.martinez', 'Demo#2026', equipos.cajaLam).expect(200);
      const { body } = respuesta;
      expect(body.equipo).toMatchObject({ nombre: 'Caja 1 Las Américas', caja_id: ids.cajaLam });
      expect(body.usuario.rol.codigo).toBe('VENDEDOR');
      expect(body.usuario.permisos).toContain('VENTAS_REGISTRAR');
      expect(body.usuario.permisos).not.toContain('VENTAS_ANULAR');
      expect(body.usuario.sucursales).toEqual([
        { id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
      ]);
      expect(cercaDe(body.sesion_expira_at, 12 * HORA_MS)).toBe(true);
      // cada ingreso desde el equipo renueva su cookie
      expect(cookiePuesta(respuesta, 'esmeralda_equipo')?.valor).toBe(equipos.cajaLam);

      const contenido = app.get(JwtService).decode<ContenidoToken>(body.access_token);
      expect(contenido.eq).toEqual({ id: body.equipo.id, suc: ids.lam, caja: ids.cajaLam });
      expect(contenido.dcp).toBe(true);
      ana.acceso = body.access_token;
      ana.sesion = cookiePuesta(respuesta, 'esmeralda_sesion')?.valor ?? '';
    });

    it('al cambiar su contraseña sigue en el mismo equipo', async () => {
      const respuesta = await conSesion('post', '/api/auth/cambiar-password', ana.acceso)
        .send({ password_actual: 'Demo#2026', password_nueva: 'Ventas#2026' })
        .expect(200);
      expect(respuesta.body.equipo.caja_id).toBe(ids.cajaLam);
      expect(cercaDe(respuesta.body.sesion_expira_at, 12 * HORA_MS)).toBe(true);
      ana.acceso = respuesta.body.access_token;
      ana.sesion = cookiePuesta(respuesta, 'esmeralda_sesion')?.valor ?? '';
    });

    it('una vendedora no puede registrar equipos (permiso validado por la base)', async () => {
      await conSesion('post', '/api/equipos', ana.acceso)
        .send({ nombre: 'Mi celular', tipo: 'MOVIL', sucursal_id: ids.lam })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere SUCURSALES_GESTIONAR',
        });
    });

    it('la bitácora de accesos registra el equipo y el motivo de cada intento', async () => {
      const { rows } = await sql<{ exito: boolean; motivo: string | null; con_equipo: boolean }>`
        select exito, motivo, dispositivo_id is not null as con_equipo from acceso_log
         where username_intentado = 'ana.martinez' order by id`.execute(bd.db);
      expect(rows).toEqual([
        { exito: false, motivo: 'equipo no autorizado', con_equipo: false },
        { exito: false, motivo: 'equipo no autorizado', con_equipo: true },
        { exito: true, motivo: null, con_equipo: true },
      ]);
    });

    it('usuario desactivado con la contraseña correcta → 403 USUARIO_INACTIVO', async () => {
      const activar = (activo: boolean) =>
        bd.transaccion(ids.admin, (trx) =>
          sql`select fn_set_usuario_activo(${ids.admin}, ${ids.carlos}, ${activo})`.execute(trx),
        );
      await activar(false);
      try {
        await login('carlos.ruiz', 'Demo#2026', equipos.tabletLbr).expect(403).expect({
          codigo: 'USUARIO_INACTIVO',
          mensaje: 'Su usuario está desactivado. Consulte al administrador.',
        });
      } finally {
        await activar(true);
      }
    });

    it('5 contraseñas incorrectas bloquean la cuenta 15 minutos', async () => {
      for (let i = 0; i < 4; i++) await login('maria.lopez', 'mala', equipos.cajaLam).expect(401);
      await login('maria.lopez', 'mala', equipos.cajaLam)
        .expect(423)
        .expect({
          codigo: 'CUENTA_BLOQUEADA',
          mensaje:
            'Cuenta bloqueada por intentos fallidos. Intente de nuevo en 15 minutos o pida al ' +
            'administrador que la desbloquee.',
        });
      await login('maria.lopez', 'Demo#2026', equipos.cajaLam).expect(423);
    });
  });

  describe('renovación y cierre de sesión', () => {
    it('refresh entrega un token nuevo, rota la cookie y no alarga la sesión', async () => {
      const yo = await conSesion('get', '/api/auth/yo', ana.acceso).expect(200);
      expect(yo.body.equipo.caja_id).toBe(ids.cajaLam);

      const antes = await bd.db
        .selectFrom('sesion')
        .select('expira_at')
        .where('refresh_token_hash', '=', sha256(ana.sesion))
        .executeTakeFirstOrThrow();
      const respuesta = await refresh(ana.sesion).expect(200);
      expect(respuesta.body.access_token).toEqual(expect.any(String));
      expect(new Date(respuesta.body.sesion_expira_at)).toEqual(antes.expira_at);
      expect(respuesta.body.equipo.caja_id).toBe(ids.cajaLam);

      const anterior = ana.sesion;
      ana.sesion = cookiePuesta(respuesta, 'esmeralda_sesion')?.valor ?? '';
      expect(ana.sesion).not.toBe(anterior);

      // el token anterior ya no sirve y la respuesta borra la cookie
      const repetido = await refresh(anterior).expect(401).expect({
        codigo: 'SESION_NO_VALIDA',
        mensaje: 'Su sesión terminó. Inicie sesión de nuevo.',
      });
      expect(cookiePuesta(repetido, 'esmeralda_sesion')?.atributos).toMatch(
        /Expires=Thu, 01 Jan 1970/,
      );
    });

    it('sin cookie de sesión → 401', async () => {
      await request(http).post('/api/auth/refresh').expect(401);
    });

    it('logout cierra la sesión y borra la cookie', async () => {
      const respuesta = await request(http)
        .post('/api/auth/logout')
        .set('Cookie', `esmeralda_sesion=${ana.sesion}`)
        .expect(204);
      expect(cookiePuesta(respuesta, 'esmeralda_sesion')?.valor).toBe('');
      await refresh(ana.sesion).expect(401);
      await request(http).post('/api/auth/logout').expect(204); // sin sesión tampoco falla
    });
  });

  describe('token de acceso', () => {
    it('sin token → 401 NO_AUTENTICADO', async () => {
      await request(http).get('/api/auth/yo').expect(401).expect({
        codigo: 'NO_AUTENTICADO',
        mensaje: 'Inicie sesión para continuar',
      });
    });

    it('token mal formado, firmado con otro secreto o sin firma → 401', async () => {
      const contenido = { sub: String(ids.admin), sid: 'x', rol: 'ADMIN', dcp: false, eq: null };
      const otroSecreto = new JwtService({ secret: 'otro-secreto-de-al-menos-32-caracteres!!' });
      const sinFirma = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify(contenido)).toString('base64url'),
        '',
      ].join('.');
      for (const token of ['abc', otroSecreto.sign(contenido), sinFirma]) {
        await conSesion('get', '/api/auth/yo', token).expect(401).expect({
          codigo: 'NO_AUTENTICADO',
          mensaje: 'El token de acceso no es válido',
        });
      }
    });

    it('token vencido → 401 TOKEN_VENCIDO (el frontend renueva con la cookie)', async () => {
      const vencido = app
        .get(JwtService)
        .sign(
          { sub: String(ids.admin), sid: 'x', rol: 'ADMIN', dcp: false, eq: null },
          { expiresIn: -10 },
        );
      await conSesion('get', '/api/auth/yo', vencido).expect(401).expect({
        codigo: 'TOKEN_VENCIDO',
        mensaje: 'Su acceso venció: renueve la sesión',
      });
    });
  });
});

describe('Límite de intentos de login por IP', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const config = cargarConfiguracion();
    app = await crearApp({
      configurar: (constructor) =>
        constructor.overrideProvider(CONFIGURACION).useValue({
          ...config,
          autenticacion: { ...config.autenticacion, limiteLoginPorMinuto: 3 },
        }),
    });
  });

  afterAll(() => app.close());

  it('pasado el límite por minuto responde 429 en español', async () => {
    const intento = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'nadie', password: 'x' });
    for (let i = 0; i < 3; i++) await intento().expect(401);
    await intento().expect(429).expect({
      codigo: 'DEMASIADOS_INTENTOS',
      mensaje: 'Demasiados intentos desde este equipo. Espere un minuto y vuelva a intentarlo.',
    });
  });
});
