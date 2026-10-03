import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AlertaAdmin } from '../src/alertas/alertas.service';
import { verificarPassword } from '../src/autenticacion/seguridad';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { EquipoAdmin } from '../src/equipos/datos-equipo';
import type { ParametroAdmin } from '../src/parametros/parametros.service';
import type { PermisoAdmin, RolAdmin } from '../src/roles/roles.service';
import type { SucursalConCajas } from '../src/sucursales/sucursales.service';
import type { UsuarioAdmin } from '../src/usuarios/usuarios.service';
import { cookiePuesta, crearApp, crearUsuarioDePrueba, tokenDeAcceso } from './utilidades';

// Recorrido completo de B3 (panel de administración) contra la base de pruebas. Las pruebas van en
// orden y comparten estado. Usan actores propios (una administradora, una vendedora y un usuario
// de prueba) para no depender de cómo dejen a "admin" y a los usuarios demo las otras pruebas, y
// al terminar devuelven los permisos de los roles y los parámetros a su valor original.

const CLAVE_JEFA = 'Panel#2026';
const FORMATO_TEMPORAL = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const HORA_MS = 60 * 60 * 1000;
const UUID_INEXISTENTE = '3f2b8c1e-7a4d-4e9b-9c55-0d6a1b2c3d4e';

type Metodo = 'get' | 'post' | 'put';

function cercaDe(fechaIso: string, msDesdeAhora: number): boolean {
  return Math.abs(new Date(fechaIso).getTime() - (Date.now() + msDesdeAhora)) < 5 * 60 * 1000;
}

describe('Panel de administración', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { adminSemilla: 0, jefa: 0, rosa: 0, tomas: 0, lam: 0, lbr: 0, bod: 0, cajaLam: 0 };
  // Lo que el "navegador" de cada persona guarda entre solicitudes
  const jefa = { acceso: '' };
  const rosa = { acceso: '', sesion: '', password: 'Vendedora#2026' };
  const tomas = { temporal: '', sesion: '' };
  const tablet = { id: '', token: '' };
  const permisosOriginales: Record<string, string[]> = {};
  const parametrosOriginales: Record<string, string | null> = {};

  function login(username: string, password: string, tokenEquipo?: string) {
    const solicitud = request(http).post('/api/auth/login');
    if (tokenEquipo) solicitud.set('Cookie', `esmeralda_equipo=${tokenEquipo}`);
    return solicitud.send({ username, password });
  }

  function conSesion(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  /** Atajo: la administradora de estas pruebas. */
  function comoJefa(metodo: Metodo, ruta: string) {
    return conSesion(metodo, ruta, jefa.acceso);
  }

  async function usuario(id: number): Promise<UsuarioAdmin> {
    return (await comoJefa('get', `/api/usuarios/${id}`).expect(200)).body.usuario;
  }

  async function ponerPermisos(rol: string, permisos: string[]): Promise<RolAdmin> {
    const respuesta = await comoJefa('put', `/api/roles/${rol}/permisos`)
      .send({ permisos })
      .expect(200);
    return respuesta.body.rol;
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const id = async (consulta: ReturnType<typeof sql<{ id: number }>>) =>
      (await consulta.execute(bd.db)).rows[0].id;
    ids.adminSemilla = await id(sql`select id from usuario where username = 'admin'`);
    ids.lam = await id(sql`select id from sucursal where codigo = 'LAM'`);
    ids.lbr = await id(sql`select id from sucursal where codigo = 'LBR'`);
    ids.bod = await id(sql`select id from sucursal where codigo = 'BOD'`);
    ids.cajaLam = await id(
      sql`select c.id from caja c join sucursal s on s.id = c.sucursal_id where s.codigo = 'LAM'`,
    );

    // La jefa: administradora con contraseña definitiva
    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa del panel',
      username: 'jefa.panel',
      password: CLAVE_JEFA,
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.panel', CLAVE_JEFA);

    const roles = await bd.db
      .selectFrom('v_roles_admin')
      .select(['codigo', 'permisos'])
      .where('editable', '=', true)
      .$castTo<{ codigo: string; permisos: string[] }>()
      .execute();
    for (const rol of roles) permisosOriginales[rol.codigo] = rol.permisos;
    const parametros = await bd.db.selectFrom('parametro').select(['clave', 'valor']).execute();
    for (const parametro of parametros) parametrosOriginales[parametro.clave] = parametro.valor;
  });

  afterAll(async () => {
    // Las otras pruebas esperan los permisos y los parámetros del seed
    await bd.transaccion(ids.adminSemilla, async (trx) => {
      for (const [codigo, permisos] of Object.entries(permisosOriginales)) {
        await sql`select fn_set_permisos_rol(${ids.adminSemilla}, ${codigo}, ${permisos}::text[])`.execute(
          trx,
        );
      }
      for (const [clave, valor] of Object.entries(parametrosOriginales)) {
        await sql`select fn_set_parametro(${ids.adminSemilla}, ${clave}, ${valor})`.execute(trx);
      }
    });
    await app.close();
  });

  it('sin sesión → 401 en todas las rutas del panel', async () => {
    const rutas: [Metodo, string][] = [
      ['get', '/api/usuarios'],
      ['post', '/api/usuarios'],
      ['get', '/api/roles'],
      ['get', '/api/permisos'],
      ['get', '/api/equipos'],
      ['get', '/api/parametros'],
      ['put', '/api/parametros/SESION_HORAS_EQUIPO'],
      ['get', '/api/alertas'],
      ['get', '/api/sucursales'],
    ];
    for (const [metodo, ruta] of rutas) {
      await request(http)[metodo](ruta).expect(401).expect({
        codigo: 'NO_AUTENTICADO',
        mensaje: 'Inicie sesión para continuar',
      });
    }
  });

  describe('usuarios', () => {
    it('GET /api/usuarios: rol, estado y sucursales de cada uno, sin datos secretos', async () => {
      const { body } = await comoJefa('get', '/api/usuarios').expect(200);
      const porUsername = new Map(
        (body.usuarios as UsuarioAdmin[]).map((u) => [u.username, u] as const),
      );
      expect(porUsername.get('ana.martinez')).toMatchObject({
        nombre_completo: 'Ana Martínez',
        email: null,
        rol: { codigo: 'VENDEDOR', nombre: 'Vendedor' },
        sucursales: [{ id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' }],
        todas_las_sucursales: false,
      });
      expect(porUsername.get('maria.lopez')).toMatchObject({
        email: 'maria@example.com',
        rol: { codigo: 'ENCARGADO', nombre: 'Encargado de sucursal' },
      });
      expect(porUsername.get('jefa.panel')).toMatchObject({
        id: ids.jefa,
        rol: { codigo: 'ADMIN', nombre: 'Administrador' },
        estado: 'ACTIVO',
        sucursales: [],
        todas_las_sucursales: true,
        debe_cambiar_password: false,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        sesiones_activas: 1,
      });
      expect(JSON.stringify(body)).not.toMatch(/password_hash|\$argon2|\$2a\$/);
    });

    it('datos inválidos → 400 con el error de cada campo', async () => {
      const { body } = await comoJefa('post', '/api/usuarios')
        .send({ nombre_completo: 'Ro', username: 'Rosa Gómez', rol: 'VENDEDOR', email: 'rosa@' })
        .expect(400);
      expect(body.codigo).toBe('DATOS_INVALIDOS');
      expect(body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'nombre_completo',
        'username',
        'email',
      ]);
    });

    it('POST /api/usuarios crea la usuaria con una contraseña temporal que se muestra una vez', async () => {
      const { body } = await comoJefa('post', '/api/usuarios')
        .send({
          nombre_completo: ' Rosa Gómez ',
          username: 'Rosa.Gomez',
          rol: 'vendedor',
          sucursales: [ids.lam],
          email: 'rosa@example.com',
        })
        .expect(201);
      expect(body.usuario).toMatchObject({
        nombre_completo: 'Rosa Gómez',
        username: 'rosa.gomez',
        email: 'rosa@example.com',
        telefono: null,
        rol: { codigo: 'VENDEDOR', nombre: 'Vendedor' },
        estado: 'ACTIVO',
        sucursales: [{ id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' }],
        todas_las_sucursales: false,
        debe_cambiar_password: true,
        ultimo_acceso: null,
        sesiones_activas: 0,
      });
      expect(body.password_temporal).toMatch(FORMATO_TEMPORAL);
      ids.rosa = body.usuario.id;

      // La base solo guarda el hash (argon2id) y quién la creó
      const guardado = await bd.db
        .selectFrom('usuario')
        .select(['password_hash', 'created_by'])
        .where('id', '=', ids.rosa)
        .executeTakeFirstOrThrow();
      expect(guardado.created_by).toBe(ids.jefa);
      expect(guardado.password_hash).toMatch(/^\$argon2id\$/);
      expect(await verificarPassword(body.password_temporal, guardado.password_hash)).toBe(true);
      rosa.password = body.password_temporal; // la cambia al entrar, más abajo
    });

    it('usuario repetido → 409; rol o sucursal inexistentes → error de la base, sin crear nada', async () => {
      const base = { nombre_completo: 'Otra Persona', rol: 'VENDEDOR', sucursales: [ids.lam] };
      const repetido = await comoJefa('post', '/api/usuarios')
        .send({ ...base, username: 'rosa.gomez' })
        .expect(409);
      expect(repetido.body).toEqual({
        codigo: 'DUPLICADO',
        mensaje: 'Ya existe un registro con esos datos',
        restriccion: 'usuario_username_key',
      });
      await comoJefa('post', '/api/usuarios')
        .send({ ...base, username: 'otra.persona', rol: 'gerente' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Rol inexistente: GERENTE' });
      const sinSucursal = await comoJefa('post', '/api/usuarios')
        .send({ ...base, username: 'otra.persona', sucursales: [999_999] })
        .expect(409);
      expect(sinSucursal.body.codigo).toBe('REFERENCIA_INVALIDA');

      const creados = await bd.db
        .selectFrom('usuario')
        .select('id')
        .where('username', '=', 'otra.persona')
        .execute();
      expect(creados).toEqual([]);
    });

    it('la usuaria nueva entra desde un equipo de su sucursal y cambia la contraseña temporal', async () => {
      const registro = await comoJefa('post', '/api/equipos')
        .send({ nombre: 'Tablet del panel', tipo: 'TABLET', sucursal_id: ids.lam })
        .expect(201);
      tablet.id = registro.body.equipo.id;
      tablet.token = cookiePuesta(registro, 'esmeralda_equipo')?.valor ?? '';

      const entrada = await login('rosa.gomez', rosa.password, tablet.token).expect(200);
      expect(entrada.body.usuario.debe_cambiar_password).toBe(true);
      const cambio = await conSesion(
        'post',
        '/api/auth/cambiar-password',
        entrada.body.access_token,
      )
        .send({ password_actual: rosa.password, password_nueva: 'Vendedora#2026' })
        .expect(200);
      rosa.password = 'Vendedora#2026';
      rosa.acceso = cambio.body.access_token;
      rosa.sesion = cookiePuesta(cambio, 'esmeralda_sesion')?.valor ?? '';
    });

    it('una vendedora no entra al panel: 403 antes de mirar siquiera los datos enviados', async () => {
      const rutas: [Metodo, string, string][] = [
        ['get', '/api/usuarios', 'USUARIOS_VER'],
        ['get', `/api/usuarios/${ids.jefa}`, 'USUARIOS_VER'],
        ['post', '/api/usuarios', 'USUARIOS_GESTIONAR'],
        ['put', `/api/usuarios/${ids.rosa}`, 'USUARIOS_GESTIONAR'],
        ['put', `/api/usuarios/${ids.jefa}/activo`, 'USUARIOS_GESTIONAR'],
        ['post', `/api/usuarios/${ids.jefa}/resetear-password`, 'USUARIOS_GESTIONAR'],
        ['post', `/api/usuarios/${ids.jefa}/cerrar-sesiones`, 'USUARIOS_GESTIONAR'],
        ['get', '/api/roles', 'USUARIOS_VER'],
        ['get', '/api/permisos', 'ROLES_GESTIONAR'],
        ['put', '/api/roles/VENDEDOR/permisos', 'ROLES_GESTIONAR'],
        ['get', '/api/equipos', 'SUCURSALES_GESTIONAR'],
        ['put', `/api/equipos/${tablet.id}/activo`, 'SUCURSALES_GESTIONAR'],
        ['get', '/api/parametros', 'PARAMETROS_GESTIONAR'],
        ['put', '/api/parametros/SESION_HORAS_EQUIPO', 'PARAMETROS_GESTIONAR'],
        ['get', '/api/alertas', 'ALERTAS_VER'],
        ['post', '/api/alertas/1/atender', 'ALERTAS_VER'],
      ];
      for (const [metodo, ruta, permiso] of rutas) {
        await conSesion(metodo, ruta, rosa.acceso)
          .expect(403)
          .expect({
            codigo: 'PERMISO_DENEGADO',
            mensaje: `Permiso denegado: se requiere ${permiso}`,
          });
      }
    });

    it('GET /api/usuarios/:id → el usuario; 404 si no existe; 400 si el id no es válido', async () => {
      expect(await usuario(ids.rosa)).toMatchObject({
        username: 'rosa.gomez',
        debe_cambiar_password: false,
        sesiones_activas: 1,
      });
      await comoJefa('get', '/api/usuarios/999999').expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'El usuario 999999 no existe',
      });
      await comoJefa('get', '/api/usuarios/abc')
        .expect(400)
        .expect({
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'El identificador de la ruta no es válido',
          errores: [{ campo: 'id', mensaje: 'El identificador de la ruta no es válido' }],
        });
    });

    it('PUT /api/usuarios/:id cambia nombre, rol, sucursales y contacto', async () => {
      const creado = await comoJefa('post', '/api/usuarios')
        .send({
          nombre_completo: 'Tomás Rivas',
          username: 'tomas.rivas',
          rol: 'VENDEDOR',
          sucursales: [ids.lam],
          email: 'tomas@example.com',
        })
        .expect(201);
      ids.tomas = creado.body.usuario.id;
      tomas.temporal = creado.body.password_temporal;

      const { body } = await comoJefa('put', `/api/usuarios/${ids.tomas}`)
        .send({
          nombre_completo: 'Tomás Rivas Solís',
          rol: 'encargado',
          sucursales: [ids.lbr, ids.lam],
          telefono: '8888-0000',
        })
        .expect(200);
      expect(body.usuario).toMatchObject({
        id: ids.tomas,
        nombre_completo: 'Tomás Rivas Solís',
        username: 'tomas.rivas',
        email: null, // no se envió: queda vacío
        telefono: '8888-0000',
        rol: { codigo: 'ENCARGADO', nombre: 'Encargado de sucursal' },
        sucursales: [
          { id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
          { id: ids.lbr, codigo: 'LBR', nombre: 'Multicentro Las Brisas' },
        ],
      });

      const auditoria = await bd.db
        .selectFrom('auditoria')
        .select(['accion', 'usuario_id'])
        .where('tabla', '=', 'usuario')
        .where('registro_id', '=', String(ids.tomas))
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();
      expect(auditoria).toEqual({ accion: 'UPDATE', usuario_id: ids.jefa });
    });

    it('la edición exige todos los datos y un usuario que exista', async () => {
      const sinSucursales = await comoJefa('put', `/api/usuarios/${ids.tomas}`)
        .send({ nombre_completo: 'Tomás Rivas Solís', rol: 'ENCARGADO' })
        .expect(400);
      expect(sinSucursales.body.errores).toEqual([
        {
          campo: 'sucursales',
          mensaje: 'Indique las sucursales del usuario (lista de ids; puede ir vacía)',
        },
      ]);
      await comoJefa('put', '/api/usuarios/999999')
        .send({ nombre_completo: 'Nadie', rol: 'VENDEDOR', sucursales: [] })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Usuario 999999 no existe' });
    });

    it('POST /api/usuarios/:id/cerrar-sesiones cierra las sesiones abiertas del usuario', async () => {
      const entrada = await login('tomas.rivas', tomas.temporal, tablet.token).expect(200);
      tomas.sesion = cookiePuesta(entrada, 'esmeralda_sesion')?.valor ?? '';
      expect((await usuario(ids.tomas)).sesiones_activas).toBe(1);

      await comoJefa('post', `/api/usuarios/${ids.tomas}/cerrar-sesiones`)
        .expect(200)
        .expect({ sesiones_cerradas: 1 });
      expect((await usuario(ids.tomas)).sesiones_activas).toBe(0);
      await request(http)
        .post('/api/auth/refresh')
        .set('Cookie', `esmeralda_sesion=${tomas.sesion}`)
        .expect(401);

      await comoJefa('post', `/api/usuarios/${ids.tomas}/cerrar-sesiones`)
        .expect(200)
        .expect({ sesiones_cerradas: 0 });
      await comoJefa('post', '/api/usuarios/999999/cerrar-sesiones').expect(404);
    });

    it('POST /api/usuarios/:id/resetear-password desbloquea y da otra contraseña temporal', async () => {
      for (let i = 0; i < 4; i++) await login('tomas.rivas', 'mala', tablet.token).expect(401);
      await login('tomas.rivas', 'mala', tablet.token).expect(423);
      expect(await usuario(ids.tomas)).toMatchObject({ estado: 'BLOQUEADO', intentos_fallidos: 5 });

      const { body } = await comoJefa(
        'post',
        `/api/usuarios/${ids.tomas}/resetear-password`,
      ).expect(200);
      expect(body.password_temporal).toMatch(FORMATO_TEMPORAL);
      expect(body.password_temporal).not.toBe(tomas.temporal);
      expect(body.usuario).toMatchObject({
        id: ids.tomas,
        estado: 'ACTIVO',
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        debe_cambiar_password: true,
      });

      await login('tomas.rivas', tomas.temporal, tablet.token).expect(401); // la anterior ya no sirve
      const entrada = await login('tomas.rivas', body.password_temporal, tablet.token).expect(200);
      expect(entrada.body.usuario.debe_cambiar_password).toBe(true);
      tomas.temporal = body.password_temporal;
      tomas.sesion = cookiePuesta(entrada, 'esmeralda_sesion')?.valor ?? '';
    });

    it('PUT /api/usuarios/:id/activo desactiva (cierra sus sesiones) y reactiva', async () => {
      const desactivado = await comoJefa('put', `/api/usuarios/${ids.tomas}/activo`)
        .send({ activo: false })
        .expect(200);
      expect(desactivado.body.usuario).toMatchObject({ estado: 'INACTIVO', sesiones_activas: 0 });
      await request(http)
        .post('/api/auth/refresh')
        .set('Cookie', `esmeralda_sesion=${tomas.sesion}`)
        .expect(401);
      const rechazo = await login('tomas.rivas', tomas.temporal, tablet.token).expect(403);
      expect(rechazo.body.codigo).toBe('USUARIO_INACTIVO');

      const reactivado = await comoJefa('put', `/api/usuarios/${ids.tomas}/activo`)
        .send({ activo: true })
        .expect(200);
      expect(reactivado.body.usuario.estado).toBe('ACTIVO');
      await login('tomas.rivas', tomas.temporal, tablet.token).expect(200);
    });

    it('reglas de la base: nadie se desactiva a sí mismo; "activo" debe ser true o false', async () => {
      await comoJefa('put', `/api/usuarios/${ids.jefa}/activo`)
        .send({ activo: false })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'No puede desactivar su propio usuario' });
      const invalido = await comoJefa('put', `/api/usuarios/${ids.tomas}/activo`)
        .send({ activo: 'no' })
        .expect(400);
      expect(invalido.body.errores).toEqual([
        { campo: 'activo', mensaje: 'Indique "activo": true o false' },
      ]);
    });
  });

  describe('roles y permisos', () => {
    let totalPermisos = 0;

    it('GET /api/roles: cada rol con sus permisos; el ADMIN los tiene todos y no es editable', async () => {
      const { body } = await comoJefa('get', '/api/roles').expect(200);
      const roles = body.roles as RolAdmin[];
      expect(roles.map((r) => r.codigo)).toEqual(['ADMIN', 'ENCARGADO', 'VENDEDOR']);
      const [admin, , vendedor] = roles;
      totalPermisos = admin.permisos.length;
      expect(admin).toMatchObject({ nombre: 'Administrador', es_sistema: true, editable: false });
      expect(admin.usuarios_activos).toBeGreaterThanOrEqual(2); // admin y la jefa
      expect(vendedor).toMatchObject({ nombre: 'Vendedor', editable: true });
      expect(vendedor.permisos).toEqual(permisosOriginales.VENDEDOR);
      expect(vendedor.permisos).toContain('VENTAS_REGISTRAR');
      expect(vendedor.permisos).not.toContain('VENTAS_ANULAR');
    });

    it('GET /api/permisos: el catálogo completo, ordenado por módulo', async () => {
      const { body } = await comoJefa('get', '/api/permisos').expect(200);
      const permisos = body.permisos as PermisoAdmin[];
      expect(permisos).toHaveLength(totalPermisos);
      expect(permisos).toContainEqual({
        codigo: 'ROLES_GESTIONAR',
        modulo: 'Usuarios',
        descripcion: 'Editar los permisos de cada rol',
      });
      const modulos = permisos.map((p) => p.modulo);
      expect(modulos.indexOf('Caja')).toBeLessThan(modulos.indexOf('Ventas'));
      expect(new Set(modulos).size).toBe(modulos.filter((m, i) => m !== modulos[i - 1]).length);
    });

    it('PUT /api/roles/:codigo/permisos: el cambio aplica de inmediato, sin volver a iniciar sesión', async () => {
      const rol = await ponerPermisos('vendedor', [...permisosOriginales.VENDEDOR, 'usuarios_ver']);
      expect(rol.codigo).toBe('VENDEDOR');
      expect(rol.permisos).toContain('USUARIOS_VER');
      expect(rol.permisos).toHaveLength(permisosOriginales.VENDEDOR.length + 1);

      // Rosa conserva su token de antes: el permiso se consulta en la base en cada solicitud
      await conSesion('get', '/api/usuarios', rosa.acceso).expect(200);
      await conSesion('post', '/api/usuarios', rosa.acceso).send({}).expect(403); // ese no se le dio
    });

    it('un usuario desactivado pierde el acceso aunque su token siga vigente', async () => {
      await comoJefa('put', `/api/usuarios/${ids.rosa}/activo`).send({ activo: false }).expect(200);
      await conSesion('get', '/api/usuarios', rosa.acceso).expect(403);
      await comoJefa('put', `/api/usuarios/${ids.rosa}/activo`).send({ activo: true }).expect(200);
      await conSesion('get', '/api/usuarios', rosa.acceso).expect(200);
      // desactivarla cerró su sesión: vuelve a entrar
      const entrada = await login('rosa.gomez', rosa.password, tablet.token).expect(200);
      rosa.acceso = entrada.body.access_token;
      rosa.sesion = cookiePuesta(entrada, 'esmeralda_sesion')?.valor ?? '';
    });

    it('al quitar el permiso del rol, se pierde el acceso', async () => {
      const rol = await ponerPermisos('VENDEDOR', permisosOriginales.VENDEDOR);
      expect(rol.permisos).toEqual(permisosOriginales.VENDEDOR);
      await conSesion('get', '/api/usuarios', rosa.acceso).expect(403);
    });

    it('con USUARIOS_GESTIONAR, quien no es admin gestiona usuarios pero no toca a un administrador', async () => {
      await ponerPermisos('VENDEDOR', [...permisosOriginales.VENDEDOR, 'USUARIOS_GESTIONAR']);
      try {
        const soloAdmin = {
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Solo un administrador puede modificar a otro administrador',
        };
        // Sin esta regla podría resetear la contraseña de la jefa, recibirla y entrar como ella
        await conSesion('post', `/api/usuarios/${ids.jefa}/resetear-password`, rosa.acceso)
          .expect(403)
          .expect(soloAdmin);
        await conSesion('put', `/api/usuarios/${ids.jefa}/activo`, rosa.acceso)
          .send({ activo: false })
          .expect(403)
          .expect(soloAdmin);
        await conSesion('post', `/api/usuarios/${ids.jefa}/cerrar-sesiones`, rosa.acceso)
          .expect(403)
          .expect(soloAdmin);
        await conSesion('put', `/api/usuarios/${ids.jefa}`, rosa.acceso)
          .send({ nombre_completo: 'Jefa del panel', rol: 'VENDEDOR', sucursales: [] })
          .expect(403)
          .expect(soloAdmin);
        await conSesion('post', '/api/usuarios', rosa.acceso)
          .send({ nombre_completo: 'Otra Jefa', username: 'otra.jefa', rol: 'ADMIN' })
          .expect(403)
          .expect({
            codigo: 'PERMISO_DENEGADO',
            mensaje: 'Solo un administrador puede asignar el rol ADMIN',
          });
        expect(await usuario(ids.jefa)).toMatchObject({
          rol: { codigo: 'ADMIN' },
          estado: 'ACTIVO',
          debe_cambiar_password: false,
          sesiones_activas: 1,
        });

        // A quien no es administrador sí lo puede gestionar
        const creado = await conSesion('post', '/api/usuarios', rosa.acceso)
          .send({ nombre_completo: 'Luis Prueba', username: 'luis.prueba', rol: 'VENDEDOR' })
          .expect(201);
        await conSesion(
          'post',
          `/api/usuarios/${creado.body.usuario.id}/resetear-password`,
          rosa.acceso,
        ).expect(200);
      } finally {
        await ponerPermisos('VENDEDOR', permisosOriginales.VENDEDOR);
      }
    });

    it('reglas de la base: ADMIN no se edita; rol y permisos deben existir', async () => {
      await comoJefa('put', '/api/roles/ADMIN/permisos').send({ permisos: [] }).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'El rol ADMIN siempre tiene todos los permisos: no se puede modificar',
      });
      await comoJefa('put', '/api/roles/GERENTE/permisos')
        .send({ permisos: [] })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Rol inexistente: GERENTE' });
      await comoJefa('put', '/api/roles/VENDEDOR/permisos')
        .send({ permisos: ['VENTAS_REGISTRAR', 'VOLAR'] })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Permiso inexistente: VOLAR' });
      // nada cambió con los intentos rechazados
      const { body } = await comoJefa('get', '/api/roles').expect(200);
      expect((body.roles as RolAdmin[])[2].permisos).toEqual(permisosOriginales.VENDEDOR);
    });

    it('datos inválidos → 400', async () => {
      const sinLista = await comoJefa('put', '/api/roles/VENDEDOR/permisos').send({}).expect(400);
      expect(sinLista.body.errores).toEqual([
        { campo: 'permisos', mensaje: 'Envíe la lista completa de permisos del rol' },
      ]);
      const codigoMalo = await comoJefa('put', '/api/roles/rol-1/permisos')
        .send({ permisos: [] })
        .expect(400);
      expect(codigoMalo.body.errores).toEqual([
        { campo: 'codigo', mensaje: 'El código del rol no es válido' },
      ]);
    });
  });

  describe('equipos', () => {
    it('GET /api/equipos: todos los equipos con su sucursal, caja y uso, sin el token', async () => {
      await comoJefa('post', '/api/equipos')
        .send({
          nombre: 'Caja del panel',
          tipo: 'CAJA',
          sucursal_id: ids.lam,
          caja_id: ids.cajaLam,
        })
        .expect(201);

      const { body } = await comoJefa('get', '/api/equipos').expect(200);
      const equipos = body.equipos as EquipoAdmin[];
      expect(equipos.find((e) => e.id === tablet.id)).toMatchObject({
        nombre: 'Tablet del panel',
        tipo: 'TABLET',
        caja_id: null,
        caja_nombre: null,
        sucursal: { id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
        activo: true,
        registrado_por: { id: ids.jefa, nombre_completo: 'Jefa del panel' },
        ultimo_uso: expect.any(String),
        sesiones_activas: 2, // Rosa y Tomás
      });
      expect(equipos.find((e) => e.nombre === 'Caja del panel')).toMatchObject({
        tipo: 'CAJA',
        caja_id: ids.cajaLam,
        caja_nombre: 'Caja 1',
        ultimo_uso: null,
        sesiones_activas: 0,
      });
      expect(JSON.stringify(body)).not.toMatch(/token/);
    });

    it('PUT /api/equipos/:id/activo: desactivar cierra sus sesiones y ya nadie entra desde él', async () => {
      const { body } = await comoJefa('put', `/api/equipos/${tablet.id}/activo`)
        .send({ activo: false })
        .expect(200);
      expect(body.equipo).toMatchObject({ id: tablet.id, activo: false, sesiones_activas: 0 });

      await request(http)
        .post('/api/auth/refresh')
        .set('Cookie', `esmeralda_sesion=${rosa.sesion}`)
        .expect(401);
      const rechazo = await login('rosa.gomez', rosa.password, tablet.token).expect(403);
      expect(rechazo.body.codigo).toBe('EQUIPO_NO_AUTORIZADO');
      await request(http)
        .get('/api/equipos/actual')
        .set('Cookie', `esmeralda_equipo=${tablet.token}`)
        .expect(200)
        .expect({ equipo: null });
    });

    it('al reactivarlo se puede volver a entrar desde el equipo', async () => {
      const { body } = await comoJefa('put', `/api/equipos/${tablet.id}/activo`)
        .send({ activo: true })
        .expect(200);
      expect(body.equipo.activo).toBe(true);
      const entrada = await login('rosa.gomez', rosa.password, tablet.token).expect(200);
      expect(entrada.body.equipo.id).toBe(tablet.id);
      rosa.acceso = entrada.body.access_token;
    });

    it('id inválido → 400; equipo inexistente → error de la base', async () => {
      const invalido = await comoJefa('put', '/api/equipos/abc/activo')
        .send({ activo: false })
        .expect(400);
      expect(invalido.body.errores).toEqual([
        { campo: 'id', mensaje: 'El identificador de la ruta no es válido' },
      ]);
      await comoJefa('put', `/api/equipos/${UUID_INEXISTENTE}/activo`)
        .send({ activo: false })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: `Equipo ${UUID_INEXISTENTE} no existe` });
    });
  });

  describe('parámetros', () => {
    const MARGEN = 'MARGEN_MINIMO_ALERTA_PCT';

    it('GET /api/parametros: valor, tipo y opciones de cada parámetro', async () => {
      const { body } = await comoJefa('get', '/api/parametros').expect(200);
      const parametros = body.parametros as ParametroAdmin[];
      expect(parametros.map((p) => p.clave)).toEqual(Object.keys(parametrosOriginales).sort());
      expect(parametros.find((p) => p.clave === 'SESION_HORAS_EQUIPO')).toMatchObject({
        valor: '12',
        tipo_valor: 'NUMERO',
        opciones: null,
        permite_vacio: false,
        descripcion: expect.stringContaining('Horas que dura una sesión'),
      });
      expect(parametros.find((p) => p.clave === 'BODEGA_VISIBILIDAD')).toMatchObject({
        valor: 'SI_NO',
        tipo_valor: 'OPCION',
        opciones: ['SI_NO', 'CANTIDAD'],
      });
      expect(parametros.find((p) => p.clave === 'CAJA_HORA_ALERTA_CIERRE')).toMatchObject({
        valor: '21:30',
        tipo_valor: 'HORA',
      });
    });

    it('PUT /api/parametros/:clave guarda el valor y queda auditado quién lo cambió', async () => {
      const { body } = await comoJefa('put', '/api/parametros/margen_minimo_alerta_pct')
        .send({ valor: 35 })
        .expect(200);
      expect(body.parametro).toMatchObject({ clave: MARGEN, valor: '35', tipo_valor: 'NUMERO' });

      const auditoria = await bd.db
        .selectFrom('auditoria')
        .select(['usuario_id', 'antes', 'despues'])
        .where('tabla', '=', 'parametro')
        .where('registro_id', '=', MARGEN)
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();
      expect(auditoria).toMatchObject({
        usuario_id: ids.jefa,
        antes: { valor: '40' },
        despues: { valor: '35' },
      });
    });

    it('la base rechaza los valores con formato inválido y el parámetro no cambia', async () => {
      const rechazos: [string, unknown, string][] = [
        [MARGEN, 'mucho', `El parámetro ${MARGEN} debe ser un número positivo (recibido: mucho)`],
        [MARGEN, null, `El parámetro ${MARGEN} no puede quedar vacío`],
        [MARGEN, '  ', `El parámetro ${MARGEN} no puede quedar vacío`],
        [
          'CAJA_HORA_ALERTA_CIERRE',
          '25:00',
          'El parámetro CAJA_HORA_ALERTA_CIERRE debe ser una hora HH:MM (recibido: 25:00)',
        ],
        [
          'BODEGA_VISIBILIDAD',
          'TODO',
          'Valor inválido para BODEGA_VISIBILIDAD: TODO. Opciones: SI_NO, CANTIDAD',
        ],
        ['NO_EXISTE', '1', 'El parámetro NO_EXISTE no existe'],
      ];
      for (const [clave, valor, mensaje] of rechazos) {
        await comoJefa('put', `/api/parametros/${clave}`)
          .send({ valor })
          .expect(422)
          .expect({ codigo: 'REGLA_NEGOCIO', mensaje });
      }
      const { body } = await comoJefa('get', '/api/parametros').expect(200);
      expect((body.parametros as ParametroAdmin[]).find((p) => p.clave === MARGEN)?.valor).toBe(
        '35',
      );
    });

    it('un parámetro que permite vacío se deja sin valor con null', async () => {
      const { body } = await comoJefa('put', '/api/parametros/VENTA_SOBREPRECIO_MAX_PCT')
        .send({ valor: null })
        .expect(200);
      expect(body.parametro).toMatchObject({ valor: null, permite_vacio: true });
    });

    it('datos inválidos → 400', async () => {
      const sinValor = await comoJefa('put', `/api/parametros/${MARGEN}`).send({}).expect(400);
      expect(sinValor.body.errores).toEqual([
        {
          campo: 'valor',
          mensaje: 'Envíe "valor": un texto, un número, o null para dejarlo vacío',
        },
      ]);
      const claveMala = await comoJefa('put', '/api/parametros/con-guion')
        .send({ valor: '1' })
        .expect(400);
      expect(claveMala.body.errores).toEqual([
        { campo: 'clave', mensaje: 'La clave del parámetro no es válida' },
      ]);
    });

    it('cambiar SESION_HORAS_EQUIPO cambia cuánto duran las sesiones nuevas', async () => {
      await comoJefa('put', '/api/parametros/SESION_HORAS_EQUIPO').send({ valor: '8' }).expect(200);
      try {
        const entrada = await login('rosa.gomez', rosa.password, tablet.token).expect(200);
        expect(cercaDe(entrada.body.sesion_expira_at, 8 * HORA_MS)).toBe(true);
      } finally {
        await comoJefa('put', '/api/parametros/SESION_HORAS_EQUIPO')
          .send({ valor: '12' })
          .expect(200);
      }
    });
  });

  describe('alertas', () => {
    const alertas = { caja: 0, sesion: 0, margen: 0 };

    async function listar(
      consulta = '',
    ): Promise<{ alertas: AlertaAdmin[]; total_pendientes: number }> {
      return (await comoJefa('get', `/api/alertas${consulta}`).expect(200)).body;
    }

    async function pendientesEnLaBase(): Promise<number> {
      const fila = await bd.db
        .selectFrom('alerta')
        .select((eb) => eb.fn.countAll<number>().as('total'))
        .where('atendida_at', 'is', null)
        .executeTakeFirstOrThrow();
      return fila.total;
    }

    beforeAll(async () => {
      // Las alertas las crea la base al aplicar sus reglas; aquí se insertan tres de ejemplo
      const filas = await bd.db
        .insertInto('alerta')
        .values([
          {
            tipo: 'CAJA_SIN_CERRAR',
            titulo: 'Panel: la caja sigue abierta',
            detalle: JSON.stringify({ turno_id: 7 }),
            sucursal_id: ids.lam,
          },
          {
            tipo: 'SESION_REUTILIZADA',
            titulo: 'Panel: posible robo de sesión',
            detalle: JSON.stringify({ usuario_id: ids.rosa, ip: '203.0.113.9' }),
            sucursal_id: null,
          },
          {
            tipo: 'MARGEN_BAJO',
            titulo: 'Panel: margen bajo',
            detalle: JSON.stringify({ margen_pct: 12.5 }),
            sucursal_id: ids.bod,
          },
        ])
        .returning('id')
        .execute();
      [alertas.caja, alertas.sesion, alertas.margen] = filas.map((f) => f.id);
    });

    it('GET /api/alertas: las pendientes, de la más reciente a la más antigua', async () => {
      const { alertas: lista, total_pendientes } = await listar();
      expect(lista.slice(0, 3).map((a) => a.id)).toEqual([
        alertas.margen,
        alertas.sesion,
        alertas.caja,
      ]);
      expect(lista[2]).toEqual({
        id: alertas.caja,
        tipo: 'CAJA_SIN_CERRAR',
        titulo: 'Panel: la caja sigue abierta',
        detalle: { turno_id: 7 },
        sucursal: { id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
        creada_at: expect.any(String),
        atendida_at: null,
        atendida_por: null,
      });
      expect(lista[1]).toMatchObject({
        sucursal: null,
        detalle: { usuario_id: ids.rosa, ip: '203.0.113.9' },
      });
      expect(lista.every((a) => a.atendida_at === null)).toBe(true);
      expect(total_pendientes).toBe(await pendientesEnLaBase());
      expect(total_pendientes).toBeGreaterThanOrEqual(3);
    });

    it('filtra por tipo y sucursal, y pagina con limite y antes_de', async () => {
      const porTipo = (await listar('?tipo=margen_bajo')).alertas;
      expect(porTipo[0].id).toBe(alertas.margen);
      expect(porTipo.every((a) => a.tipo === 'MARGEN_BAJO')).toBe(true);

      const porSucursal = (await listar(`?sucursal_id=${ids.lam}`)).alertas;
      expect(porSucursal[0].id).toBe(alertas.caja);
      expect(porSucursal.every((a) => a.sucursal?.id === ids.lam)).toBe(true);

      const primera = (await listar('?limite=1')).alertas;
      expect(primera.map((a) => a.id)).toEqual([alertas.margen]);
      const siguiente = (await listar(`?limite=1&antes_de=${alertas.margen}`)).alertas;
      expect(siguiente.map((a) => a.id)).toEqual([alertas.sesion]);
    });

    it('filtros inválidos → 400', async () => {
      const { body } = await comoJefa('get', '/api/alertas?estado=viejas&limite=500').expect(400);
      expect(body.errores).toEqual([
        { campo: 'estado', mensaje: 'estado debe ser pendientes, atendidas o todas' },
        { campo: 'limite', mensaje: 'limite debe ser un número entre 1 y 200' },
      ]);
    });

    it('POST /api/alertas/:id/atender registra quién la atendió y sale de las pendientes', async () => {
      const antes = (await listar()).total_pendientes;
      const { body } = await comoJefa('post', `/api/alertas/${alertas.sesion}/atender`).expect(200);
      expect(body.alerta).toMatchObject({
        id: alertas.sesion,
        tipo: 'SESION_REUTILIZADA',
        atendida_at: expect.any(String),
        atendida_por: { id: ids.jefa, nombre_completo: 'Jefa del panel' },
      });

      const pendientes = await listar();
      expect(pendientes.total_pendientes).toBe(antes - 1);
      expect(pendientes.alertas.map((a) => a.id)).not.toContain(alertas.sesion);
      const atendidas = (await listar('?estado=atendidas')).alertas;
      expect(atendidas[0].id).toBe(alertas.sesion);
      expect(atendidas.every((a) => a.atendida_at !== null)).toBe(true);
      const todas = (await listar('?estado=todas&limite=3')).alertas;
      expect(todas.map((a) => a.id)).toEqual([alertas.margen, alertas.sesion, alertas.caja]);

      // atenderla otra vez no cambia nada
      const repetida = await comoJefa('post', `/api/alertas/${alertas.sesion}/atender`).expect(200);
      expect(repetida.body.alerta.atendida_at).toBe(body.alerta.atendida_at);
    });

    it('alerta inexistente → 404', async () => {
      await comoJefa('post', '/api/alertas/999999999/atender').expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'La alerta 999999999 no existe',
      });
    });
  });

  describe('sucursales', () => {
    it('GET /api/sucursales: el admin ve todas las ubicaciones con sus cajas', async () => {
      const { body } = await comoJefa('get', '/api/sucursales').expect(200);
      const sucursales = body.sucursales as SucursalConCajas[];
      // (otras pruebas pueden haber creado más sucursales: las del seed van primero)
      expect(sucursales.slice(0, 3).map((s) => s.codigo)).toEqual(['LAM', 'LBR', 'BOD']);
      expect(sucursales[0]).toMatchObject({
        id: ids.lam,
        codigo: 'LAM',
        nombre: 'Multicentro Las Américas',
        tipo: 'SUCURSAL',
        direccion: 'Multicentro Las Américas, Managua',
        activa: true,
        cajas: [{ id: ids.cajaLam, nombre: 'Caja 1', activa: true }],
      });
      expect(sucursales[2]).toMatchObject({ tipo: 'BODEGA', cajas: [] });
    });

    it('una vendedora solo ve las sucursales donde trabaja', async () => {
      const { body } = await conSesion('get', '/api/sucursales', rosa.acceso).expect(200);
      expect((body.sucursales as SucursalConCajas[]).map((s) => s.codigo)).toEqual(['LAM']);
    });
  });
});
