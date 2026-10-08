import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types';
import type { AlertaAdmin } from '../src/alertas/alertas.service';
import type { PantallaPin } from '../src/autenticacion/autenticacion.service';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import {
  cookiePuesta,
  crearApp,
  crearUsuarioDePrueba,
  registrarTablet,
  tokenDeAcceso,
} from './utilidades';

// Cambio rápido de vendedora con PIN en un equipo registrado. Una sucursal propia con su tablet:
// Pía y Pilar (vendedoras) trabajan en ella; Otilia, en otra sucursal. El equipo se abre con una
// contraseña y desde ahí acepta PIN; cada PIN abre la sesión de esa persona.

const CLAVE = 'Pines#2026';
const HORA_MS = 60 * 60 * 1000;

describe('PIN: cambio rápido de vendedora', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { jefa: 0, pia: 0, pilar: 0, otilia: 0, suc: 0, otra: 0 };
  let tablet = '';
  let tabletOtra = '';
  const jefa = { acceso: '' };
  /** La sesión de Pía en la tablet (por contraseña) y su cookie. */
  const pia = { acceso: '', sesion: '' };

  function enTablet(metodo: 'get' | 'post' | 'put', ruta: string, equipo = tablet) {
    return request(http)[metodo](ruta).set('Cookie', `esmeralda_equipo=${equipo}`);
  }

  function con(metodo: 'get' | 'post' | 'put', ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function entrarConPin(usuarioId: number, pin: string, equipo: string | null = tablet) {
    const solicitud = request(http).post('/api/auth/pin');
    if (equipo) solicitud.set('Cookie', `esmeralda_equipo=${equipo}`);
    return solicitud.send({ usuario_id: usuarioId, pin });
  }

  async function pantalla(equipo = tablet): Promise<PantallaPin> {
    return (await enTablet('get', '/api/auth/pin/usuarios', equipo).expect(200)).body;
  }

  async function entrarConPassword(username: string, equipo = tablet): Promise<Response> {
    return request(http)
      .post('/api/auth/login')
      .set('Cookie', `esmeralda_equipo=${equipo}`)
      .send({ username, password: CLAVE })
      .expect(200);
  }

  async function crearPin(acceso: string, pin: string, password = CLAVE): Promise<Response> {
    return con('put', '/api/auth/pin', acceso).send({ password_actual: password, pin });
  }

  async function alertasDePin(): Promise<AlertaAdmin[]> {
    const { body } = await con('get', '/api/alertas?tipo=PIN_BLOQUEADO', jefa.acceso).expect(200);
    return (body.alertas as AlertaAdmin[]).filter((a) => a.sucursal?.id === ids.suc);
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de los pines',
      username: 'jefa.pin',
      password: CLAVE,
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.pin', CLAVE);
    for (const [codigo, clave] of [
      ['PNA', 'suc'],
      ['PNB', 'otra'],
    ]) {
      const { body } = await con('post', '/api/sucursales', jefa.acceso)
        .send({ codigo, nombre: `Sucursal ${codigo} e2e`, direccion: 'Plaza', telefono: '2222' })
        .expect(201);
      Object.assign(ids, { [clave]: body.sucursal.id });
      await con('post', `/api/sucursales/${body.sucursal.id}/cajas`, jefa.acceso)
        .send({ nombre: 'Caja 1' })
        .expect(201);
    }
    tablet = await registrarTablet(app, jefa.acceso, 'Tablet PNA', ids.suc);
    tabletOtra = await registrarTablet(app, jefa.acceso, 'Tablet PNB', ids.otra);
    const actores: [string, string, number][] = [
      ['Pía Pines', 'pia.pin', ids.suc],
      ['Pilar Pines', 'pilar.pin', ids.suc],
      ['Otilia Pines', 'otilia.pin', ids.otra],
    ];
    for (const [nombre, username, sucursal] of actores) {
      const id = await crearUsuarioDePrueba(app, {
        nombre,
        username,
        password: CLAVE,
        rol: 'VENDEDOR',
        sucursales: [sucursal],
      });
      Object.assign(ids, { [username.split('.')[0]]: id });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('crear el PIN', () => {
    it('un equipo que nadie ha abierto está cerrado: no muestra a nadie ni acepta PIN', async () => {
      expect(await pantalla()).toEqual({
        equipo: expect.objectContaining({ nombre: 'Tablet PNA' }),
        abierto: false,
        usuarios: [],
      });
      // un navegador que no es un equipo registrado
      const sinEquipo = await request(http).get('/api/auth/pin/usuarios').expect(200);
      expect(sinEquipo.body).toEqual({ equipo: null, abierto: false, usuarios: [] });
    });

    it('cada quien crea el suyo, confirmando con su contraseña', async () => {
      const entrada = await entrarConPassword('pia.pin');
      pia.acceso = entrada.body.access_token;
      pia.sesion = cookiePuesta(entrada, 'esmeralda_sesion')?.valor ?? '';
      expect(entrada.body.usuario.pin).toBe('SIN_PIN');
      expect(entrada.body.pantalla_bloqueo_minutos).toBe(3);

      const mala = await crearPin(pia.acceso, '2580', 'OtraClave#1');
      expect(mala.status).toBe(422);
      expect(mala.body).toEqual({
        codigo: 'PASSWORD_ACTUAL_INCORRECTA',
        mensaje: 'La contraseña no es correcta',
      });
      for (const [pin, mensaje] of [
        ['12a4', 'El PIN debe tener exactamente 4 dígitos'],
        ['25800', 'El PIN debe tener exactamente 4 dígitos'],
        ['7777', 'Ese PIN es muy fácil de adivinar: no use 0000, 1234 ni parecidos'],
        ['1234', 'Ese PIN es muy fácil de adivinar: no use 0000, 1234 ni parecidos'],
        ['8765', 'Ese PIN es muy fácil de adivinar: no use 0000, 1234 ni parecidos'],
      ]) {
        const rechazado = await crearPin(pia.acceso, pin);
        expect(rechazado.status).toBe(400);
        expect(rechazado.body.errores).toEqual([{ campo: 'pin', mensaje }]);
      }
      expect((await crearPin(pia.acceso, '2580')).status).toBe(204);

      const yo = await con('get', '/api/auth/yo', pia.acceso).expect(200);
      expect(yo.body.usuario.pin).toBe('ACTIVO');
      // El PIN se guarda con hash, como la contraseña
      const fila = await bd.db
        .selectFrom('usuario')
        .select('pin_hash')
        .where('id', '=', ids.pia)
        .executeTakeFirstOrThrow();
      expect(fila.pin_hash).toMatch(/^\$argon2id\$/);
    });

    it('el administrador no usa PIN', async () => {
      const respuesta = await crearPin(jefa.acceso, '2580');
      expect(respuesta.status).toBe(422);
      expect(respuesta.body).toEqual({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'El administrador no usa PIN: entra siempre con su contraseña',
      });
    });

    it('se puede crear también desde el celular, pero ahí no se entra con PIN', async () => {
      const celular = await tokenDeAcceso(app, 'pilar.pin', CLAVE);
      expect((await crearPin(celular, '1357')).status).toBe(204);
      await entrarConPin(ids.pilar, '1357', null).expect(403).expect({
        codigo: 'EQUIPO_CERRADO',
        mensaje:
          'Este equipo está cerrado: la primera persona del día entra con su usuario y contraseña.',
      });
    });
  });

  describe('entrar con PIN', () => {
    it('con el equipo abierto, la pantalla de bloqueo muestra a quienes trabajan en esa sucursal', async () => {
      // Pía entró con su contraseña: eso abrió el equipo
      expect(await pantalla()).toEqual({
        equipo: expect.objectContaining({ nombre: 'Tablet PNA' }),
        abierto: true,
        usuarios: [
          { id: ids.pia, nombre_completo: 'Pía Pines', pin_bloqueado: false },
          { id: ids.pilar, nombre_completo: 'Pilar Pines', pin_bloqueado: false },
        ],
      });
      // la tablet de la otra sucursal sigue cerrada
      expect((await pantalla(tabletOtra)).abierto).toBe(false);
    });

    it('el PIN abre la sesión de esa persona, y lo que hace queda a su nombre', async () => {
      const respuesta = await entrarConPin(ids.pilar, '1357').expect(200);
      expect(respuesta.body).toMatchObject({
        acceso: 'COMPLETO',
        equipo: { nombre: 'Tablet PNA' },
        usuario: { id: ids.pilar, username: 'pilar.pin', pin: 'ACTIVO' },
      });
      // su sesión no dura más que la apertura del equipo (12 horas desde que entró Pía)
      const vence = new Date(respuesta.body.sesion_expira_at).getTime() - Date.now();
      expect(vence).toBeLessThanOrEqual(12 * HORA_MS);
      expect(vence).toBeGreaterThan(11.9 * HORA_MS);
      expect(cookiePuesta(respuesta, 'esmeralda_sesion')?.valor).toBeTruthy();

      // Pilar abre la caja: el turno lo abrió Pilar, no Pía (que fue quien abrió el equipo)
      const pilar = respuesta.body.access_token as string;
      await con('post', '/api/caja/turno/abrir', pilar).send({ inicial_nio: 100 }).expect(201);
      const abierta = await con('get', '/api/caja/turno', pilar).expect(200);
      expect(abierta.body.turno.abierto_por).toMatchObject({ id: ids.pilar });

      const filas = await sql<{ metodo: string; exito: boolean }>`
        select metodo, exito from acceso_log where usuario_id = ${ids.pilar} order by id desc limit 1`.execute(
        bd.db,
      );
      expect(filas.rows).toEqual([{ metodo: 'PIN', exito: true }]);
    });

    it('en la tablet de otra sucursal su PIN no sirve, y quien no tiene PIN tampoco entra', async () => {
      await entrarConPassword('otilia.pin', tabletOtra); // abre la otra tablet
      const noDisponible = {
        codigo: 'PIN_NO_DISPONIBLE',
        mensaje: 'No puede entrar con PIN en este equipo. Entre con su usuario y contraseña.',
      };
      await entrarConPin(ids.pilar, '1357', tabletOtra).expect(403).expect(noDisponible);
      await entrarConPin(ids.otilia, '1357', tabletOtra).expect(403).expect(noDisponible); // sin PIN
      await entrarConPin(ids.jefa, '2580').expect(403).expect(noDisponible); // la administradora
      await entrarConPin(999999999, '2580').expect(403).expect(noDisponible);
      expect((await pantalla(tabletOtra)).usuarios).toEqual([]);
      const invalido = await entrarConPin(ids.pilar, '13').expect(400);
      expect(invalido.body.errores).toEqual([{ campo: 'pin', mensaje: 'El PIN tiene 4 dígitos' }]);
    });
  });

  describe('bloqueo a los 5 intentos', () => {
    it('cada PIN incorrecto dice cuántos quedan; el correcto reinicia la cuenta', async () => {
      await entrarConPin(ids.pia, '0001').expect(401).expect({
        codigo: 'PIN_INCORRECTO',
        mensaje: 'PIN incorrecto. Le quedan 4 intentos.',
      });
      await entrarConPin(ids.pia, '0002').expect(401);
      await entrarConPin(ids.pia, '0003').expect(401);
      await entrarConPin(ids.pia, '0004').expect(401).expect({
        codigo: 'PIN_INCORRECTO',
        mensaje: 'PIN incorrecto. Le queda 1 intento.',
      });
      await entrarConPin(ids.pia, '2580').expect(200);
      await entrarConPin(ids.pia, '0001').expect(401).expect({
        codigo: 'PIN_INCORRECTO',
        mensaje: 'PIN incorrecto. Le quedan 4 intentos.',
      });
    });

    it('el quinto seguido lo bloquea, alerta al administrador y ni el PIN correcto entra', async () => {
      const bloqueado = {
        codigo: 'PIN_BLOQUEADO',
        mensaje:
          'Su PIN está bloqueado por intentos fallidos. Entre con su usuario y contraseña y cree uno nuevo.',
      };
      for (const pin of ['0002', '0003', '0004']) await entrarConPin(ids.pia, pin).expect(401);
      await entrarConPin(ids.pia, '0005').expect(423).expect(bloqueado);
      await entrarConPin(ids.pia, '2580').expect(423).expect(bloqueado);
      expect((await pantalla()).usuarios[0]).toEqual({
        id: ids.pia,
        nombre_completo: 'Pía Pines',
        pin_bloqueado: true,
      });
      expect(await alertasDePin()).toEqual([
        expect.objectContaining({
          titulo: 'PIN bloqueado: Pía Pines falló 5 veces seguidas en Tablet PNA',
          detalle: expect.objectContaining({ usuario_id: ids.pia }),
        }),
      ]);
      const panel = await con('get', `/api/usuarios/${ids.pia}`, jefa.acceso).expect(200);
      expect(panel.body.usuario).toMatchObject({ pin: 'BLOQUEADO', estado: 'ACTIVO' });
    });

    it('con su contraseña sigue entrando y crea un PIN nuevo: se desbloquea (la alerta queda)', async () => {
      const entrada = await entrarConPassword('pia.pin');
      expect(entrada.body.usuario.pin).toBe('BLOQUEADO');
      expect((await crearPin(entrada.body.access_token, '9630')).status).toBe(204);
      await entrarConPin(ids.pia, '2580').expect(401); // el viejo ya no vale
      await entrarConPin(ids.pia, '9630').expect(200);
      expect(await alertasDePin()).toHaveLength(1);
    });

    it('el administrador reinicia un PIN: queda sin PIN y su alerta, atendida', async () => {
      await con('post', `/api/usuarios/${ids.pia}/reiniciar-pin`, pia.acceso).expect(403);
      const { body } = await con(
        'post',
        `/api/usuarios/${ids.pia}/reiniciar-pin`,
        jefa.acceso,
      ).expect(200);
      expect(body.usuario).toMatchObject({ id: ids.pia, pin: 'SIN_PIN' });
      expect(await alertasDePin()).toEqual([]);
      expect((await pantalla()).usuarios.map((u) => u.id)).toEqual([ids.pilar]);
      await entrarConPin(ids.pia, '9630').expect(403);
      await con('post', '/api/usuarios/999999999/reiniciar-pin', jefa.acceso).expect(422);
    });
  });

  describe('cerrar el equipo', () => {
    it('quien trabaja en él lo cierra: se cierran sus sesiones y deja de aceptar PIN', async () => {
      const pilar = await entrarConPin(ids.pilar, '1357').expect(200);
      const sesionDePilar = cookiePuesta(pilar, 'esmeralda_sesion')?.valor ?? '';
      // desde el celular no se cierra un equipo
      const celular = await tokenDeAcceso(app, 'pilar.pin', CLAVE);
      await con('post', '/api/equipos/actual/cerrar', celular).expect(403).expect({
        codigo: 'EQUIPO_REQUERIDO',
        mensaje:
          'Esto solo se puede hacer desde un equipo registrado de la sucursal (la tablet o la caja)',
      });

      const cierre = await con(
        'post',
        '/api/equipos/actual/cerrar',
        pilar.body.access_token,
      ).expect(204);
      expect(cookiePuesta(cierre, 'esmeralda_sesion')?.valor).toBe('');
      await request(http)
        .post('/api/auth/refresh')
        .set('Cookie', `esmeralda_sesion=${sesionDePilar}`)
        .expect(401);
      expect(await pantalla()).toMatchObject({ abierto: false, usuarios: [] });
      await entrarConPin(ids.pilar, '1357').expect(403).expect({
        codigo: 'EQUIPO_CERRADO',
        mensaje:
          'Este equipo está cerrado: la primera persona del día entra con su usuario y contraseña.',
      });
    });

    it('al día siguiente, la primera entra con su contraseña y el PIN vuelve a servir', async () => {
      await entrarConPassword('pia.pin');
      expect((await pantalla()).abierto).toBe(true);
      const pilar = await entrarConPin(ids.pilar, '1357').expect(200);
      // Deja la sucursal sin turno abierto
      const turno = await con('get', '/api/caja/turno', pilar.body.access_token).expect(200);
      await con('post', `/api/turnos/${turno.body.turno.id}/cierre-forzado`, jefa.acceso)
        .send({ motivo: 'Cierre de las pruebas del PIN' })
        .expect(200);
      // pasadas las horas de la apertura el equipo se cierra solo
      await sql`update dispositivo set abierto_hasta = now() - interval '1 minute'
                 where nombre = 'Tablet PNA'`.execute(bd.db);
      await entrarConPin(ids.pilar, '1357').expect(403);
    });
  });
});
