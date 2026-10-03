import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AccesoRegistrado, CambioAuditado } from '../src/auditoria/auditoria.service';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { ParametroAdmin } from '../src/parametros/parametros.service';
import type { RolAdmin } from '../src/roles/roles.service';
import type { SucursalConCajas } from '../src/sucursales/sucursales.service';
import { crearApp, crearUsuarioDePrueba, registrarTablet, tokenDeAcceso } from './utilidades';

// Lo que quedó pendiente del panel de administración (B3): crear y editar sucursales y cajas, crear
// roles, desbloquear cuentas, mínimo de los parámetros y la bitácora de cambios y accesos.
// Usa actores propios y, al terminar, deja inactiva la sucursal que crea.

type Metodo = 'get' | 'post' | 'put' | 'delete';

/** La fecha de hoy en Managua (AAAA-MM-DD), como la usan los filtros por fecha. */
function hoyEnManagua(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date());
}

describe('Organización y bitácora', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { jefa: 0, lam: 0, bod: 0, metro: 0, cajaMetro: 0, supervisora: 0 };
  const jefa = { acceso: '' };
  const vera = { acceso: '' };
  const tablet = { token: '' };
  const supervisora = { temporal: '' };

  function conSesion(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function comoJefa(metodo: Metodo, ruta: string) {
    return conSesion(metodo, ruta, jefa.acceso);
  }

  function login(username: string, password: string) {
    return request(http)
      .post('/api/auth/login')
      .set('Cookie', `esmeralda_equipo=${tablet.token}`)
      .send({ username, password });
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const sucursales = await bd.db.selectFrom('sucursal').select(['id', 'codigo']).execute();
    ids.lam = sucursales.find((s) => s.codigo === 'LAM')?.id ?? 0;
    ids.bod = sucursales.find((s) => s.codigo === 'BOD')?.id ?? 0;

    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de organización',
      username: 'jefa.organizacion',
      password: 'Organiza#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.organizacion', 'Organiza#2026');
    await crearUsuarioDePrueba(app, {
      nombre: 'Vera Organización',
      username: 'vera.organizacion',
      password: 'Vendedora#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.lam],
    });
    tablet.token = await registrarTablet(app, jefa.acceso, 'Tablet de organización', ids.lam);
    vera.acceso = await tokenDeAcceso(app, 'vera.organizacion', 'Vendedora#2026', tablet.token);
  });

  afterAll(() => app.close());

  describe('sucursales y cajas', () => {
    it('POST /api/sucursales crea una sucursal de venta', async () => {
      const { body } = await comoJefa('post', '/api/sucursales')
        .send({
          codigo: 'met',
          nombre: ' Metrocentro ',
          direccion: 'Metrocentro, Managua',
          telefono: '2222-0000',
        })
        .expect(201);
      expect(body.sucursal).toEqual({
        id: expect.any(Number),
        codigo: 'MET',
        nombre: 'Metrocentro',
        tipo: 'SUCURSAL',
        direccion: 'Metrocentro, Managua',
        telefono: '2222-0000',
        activa: true,
        cajas: [],
      });
      ids.metro = body.sucursal.id;
    });

    it('código repetido → 409; datos inválidos → 400', async () => {
      const repetida = await comoJefa('post', '/api/sucursales')
        .send({ codigo: 'MET', nombre: 'Otra sucursal' })
        .expect(409);
      expect(repetida.body).toMatchObject({
        codigo: 'DUPLICADO',
        restriccion: 'sucursal_codigo_key',
      });
      const invalida = await comoJefa('post', '/api/sucursales')
        .send({ codigo: 'M1', nombre: 'Me' })
        .expect(400);
      expect(invalida.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'codigo',
        'nombre',
      ]);
    });

    it('PUT /api/sucursales/:id la edita; sin ventas puede cambiar de código', async () => {
      const { body } = await comoJefa('put', `/api/sucursales/${ids.metro}`)
        .send({ codigo: 'MTC', nombre: 'Metrocentro Managua' })
        .expect(200);
      expect(body.sucursal).toMatchObject({
        id: ids.metro,
        codigo: 'MTC',
        nombre: 'Metrocentro Managua',
        direccion: null,
        telefono: null,
      });
      await comoJefa('put', '/api/sucursales/999999')
        .send({ codigo: 'XXX', nombre: 'Nada' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La sucursal 999999 no existe' });
    });

    it('POST /api/sucursales/:id/cajas agrega una caja; la bodega no lleva cajas', async () => {
      const { body } = await comoJefa('post', `/api/sucursales/${ids.metro}/cajas`)
        .send({ nombre: ' Caja 1 ' })
        .expect(201);
      expect(body.sucursal.cajas).toEqual([
        { id: expect.any(Number), nombre: 'Caja 1', activa: true },
      ]);
      ids.cajaMetro = body.sucursal.cajas[0].id;

      const repetida = await comoJefa('post', `/api/sucursales/${ids.metro}/cajas`)
        .send({ nombre: 'Caja 1' })
        .expect(409);
      expect(repetida.body.codigo).toBe('DUPLICADO');
      await comoJefa('post', `/api/sucursales/${ids.bod}/cajas`)
        .send({ nombre: 'Caja bodega' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Solo las sucursales de venta pueden tener cajas (la bodega no vende)',
        });
      await comoJefa('post', '/api/sucursales/999999/cajas')
        .send({ nombre: 'Caja' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La sucursal 999999 no existe' });
    });

    it('PUT /api/cajas/:id la renombra y /activa la desactiva o reactiva', async () => {
      const renombrada = await comoJefa('put', `/api/cajas/${ids.cajaMetro}`)
        .send({ nombre: 'Caja principal' })
        .expect(200);
      expect(renombrada.body.sucursal).toMatchObject({
        id: ids.metro,
        cajas: [{ id: ids.cajaMetro, nombre: 'Caja principal', activa: true }],
      });
      const inactiva = await comoJefa('put', `/api/cajas/${ids.cajaMetro}/activa`)
        .send({ activa: false })
        .expect(200);
      expect(inactiva.body.sucursal.cajas[0].activa).toBe(false);
      await comoJefa('put', `/api/cajas/${ids.cajaMetro}/activa`)
        .send({ activa: true })
        .expect(200);
      await comoJefa('put', '/api/cajas/999999')
        .send({ nombre: 'Nada' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La caja 999999 no existe' });
    });

    it('GET /api/sucursales: el admin ve la nueva; una vendedora solo las suyas', async () => {
      const delAdmin = await comoJefa('get', '/api/sucursales').expect(200);
      expect((delAdmin.body.sucursales as SucursalConCajas[]).map((s) => s.codigo)).toContain(
        'MTC',
      );
      const deVera = await conSesion('get', '/api/sucursales', vera.acceso).expect(200);
      expect((deVera.body.sucursales as SucursalConCajas[]).map((s) => s.codigo)).toEqual(['LAM']);
    });

    it('reglas de la base al desactivar: ni la bodega ni una sucursal con existencias', async () => {
      await comoJefa('put', `/api/sucursales/${ids.bod}/activa`)
        .send({ activa: false })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La bodega central no se puede desactivar: por ella entra toda la mercadería',
        });
      const conStock = await comoJefa('put', `/api/sucursales/${ids.lam}/activa`)
        .send({ activa: false })
        .expect(422);
      expect(conStock.body.mensaje).toMatch(
        /^"Multicentro Las Américas" todavía tiene \d+ unidad\(es\) en existencia: envíelas a otra ubicación antes de desactivarla$/,
      );
    });

    it('una vendedora no administra sucursales ni cajas', async () => {
      const rutas: [Metodo, string][] = [
        ['post', '/api/sucursales'],
        ['put', `/api/sucursales/${ids.metro}`],
        ['put', `/api/sucursales/${ids.metro}/activa`],
        ['post', `/api/sucursales/${ids.metro}/cajas`],
        ['put', `/api/cajas/${ids.cajaMetro}`],
        ['put', `/api/cajas/${ids.cajaMetro}/activa`],
      ];
      for (const [metodo, ruta] of rutas) {
        await conSesion(metodo, ruta, vera.acceso).expect(403).expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere SUCURSALES_GESTIONAR',
        });
      }
    });

    it('PUT /api/sucursales/:id/activa desactiva una sucursal vacía', async () => {
      const { body } = await comoJefa('put', `/api/sucursales/${ids.metro}/activa`)
        .send({ activa: false })
        .expect(200);
      expect(body.sucursal).toMatchObject({ id: ids.metro, activa: false });
    });
  });

  describe('roles nuevos', () => {
    it('POST /api/roles crea un rol sin permisos', async () => {
      const { body } = await comoJefa('post', '/api/roles')
        .send({ codigo: ' supervisor ', nombre: ' Supervisor ', descripcion: 'Revisa las cajas' })
        .expect(201);
      expect(body.rol).toEqual({
        codigo: 'SUPERVISOR',
        nombre: 'Supervisor',
        descripcion: 'Revisa las cajas',
        es_sistema: false,
        editable: true,
        permisos: [],
        usuarios_activos: 0,
        usuarios: 0,
      });
    });

    it('código repetido → 409; datos inválidos → 400', async () => {
      const repetido = await comoJefa('post', '/api/roles')
        .send({ codigo: 'SUPERVISOR', nombre: 'Otro supervisor' })
        .expect(409);
      expect(repetido.body).toMatchObject({ codigo: 'DUPLICADO', restriccion: 'rol_codigo_key' });
      const invalido = await comoJefa('post', '/api/roles')
        .send({ codigo: 'jefe 1', nombre: 'J' })
        .expect(400);
      expect(invalido.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'codigo',
        'nombre',
      ]);
    });

    it('se le dan permisos y se le cambia el nombre', async () => {
      const conPermisos = await comoJefa('put', '/api/roles/supervisor/permisos')
        .send({ permisos: ['CAJA_VER_DIFERENCIAS', 'REPORTES_VER'] })
        .expect(200);
      expect(conPermisos.body.rol.permisos).toEqual(['CAJA_VER_DIFERENCIAS', 'REPORTES_VER']);
      const { body } = await comoJefa('put', '/api/roles/supervisor')
        .send({ nombre: 'Supervisora' })
        .expect(200);
      expect(body.rol).toMatchObject({
        codigo: 'SUPERVISOR',
        nombre: 'Supervisora',
        descripcion: null,
        permisos: ['CAJA_VER_DIFERENCIAS', 'REPORTES_VER'],
      });
      await comoJefa('put', '/api/roles/gerente')
        .send({ nombre: 'Gerente' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Rol inexistente: GERENTE' });
    });

    it('un rol con usuarios no se elimina; los de sistema, nunca (reglas de la base)', async () => {
      const creada = await comoJefa('post', '/api/usuarios')
        .send({
          nombre_completo: 'Sara Supervisora',
          username: 'sara.supervisora',
          rol: 'supervisor',
          sucursales: [ids.lam],
        })
        .expect(201);
      expect(creada.body.usuario.rol).toEqual({ codigo: 'SUPERVISOR', nombre: 'Supervisora' });
      ids.supervisora = creada.body.usuario.id;
      supervisora.temporal = creada.body.password_temporal;

      await comoJefa('delete', '/api/roles/SUPERVISOR').expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'El rol SUPERVISOR tiene 1 usuario(s): asígneles otro rol antes de eliminarlo',
      });
      await comoJefa('delete', '/api/roles/VENDEDOR').expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'El rol VENDEDOR es de sistema y no se puede eliminar',
      });
      await comoJefa('delete', '/api/roles/GERENTE')
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Rol inexistente: GERENTE' });
    });

    it('DELETE /api/roles/:codigo lo elimina cuando ya no tiene usuarios', async () => {
      await comoJefa('put', `/api/usuarios/${ids.supervisora}`)
        .send({ nombre_completo: 'Sara Supervisora', rol: 'VENDEDOR', sucursales: [ids.lam] })
        .expect(200);
      await comoJefa('delete', '/api/roles/supervisor').expect(204);
      const { body } = await comoJefa('get', '/api/roles').expect(200);
      expect((body.roles as RolAdmin[]).map((r) => r.codigo)).not.toContain('SUPERVISOR');
    });

    it('una vendedora no administra roles', async () => {
      const rutas: [Metodo, string][] = [
        ['post', '/api/roles'],
        ['put', '/api/roles/VENDEDOR'],
        ['delete', '/api/roles/VENDEDOR'],
      ];
      for (const [metodo, ruta] of rutas) {
        await conSesion(metodo, ruta, vera.acceso).expect(403).expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere ROLES_GESTIONAR',
        });
      }
    });
  });

  describe('desbloquear una cuenta', () => {
    it('POST /api/usuarios/:id/desbloquear quita el bloqueo sin cambiar la contraseña', async () => {
      for (let i = 0; i < 4; i++) await login('sara.supervisora', 'mala').expect(401);
      await login('sara.supervisora', 'mala').expect(423);
      await login('sara.supervisora', supervisora.temporal).expect(423); // ni la correcta entra

      const { body } = await comoJefa(
        'post',
        `/api/usuarios/${ids.supervisora}/desbloquear`,
      ).expect(200);
      expect(body.usuario).toMatchObject({
        id: ids.supervisora,
        estado: 'ACTIVO',
        intentos_fallidos: 0,
        bloqueado_hasta: null,
      });
      expect(body).not.toHaveProperty('password_temporal');
      await login('sara.supervisora', supervisora.temporal).expect(200); // la misma contraseña
    });

    it('usuario inexistente → error de la base; una vendedora no desbloquea', async () => {
      await comoJefa('post', '/api/usuarios/999999/desbloquear')
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Usuario 999999 no existe' });
      await conSesion('post', `/api/usuarios/${ids.supervisora}/desbloquear`, vera.acceso)
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere USUARIOS_GESTIONAR',
        });
    });
  });

  describe('parámetros con mínimo', () => {
    it('GET /api/parametros informa el mínimo de cada parámetro', async () => {
      const { body } = await comoJefa('get', '/api/parametros').expect(200);
      const parametros = body.parametros as ParametroAdmin[];
      const minimo = (clave: string) => parametros.find((p) => p.clave === clave)?.minimo;
      expect(minimo('SESION_HORAS_EQUIPO')).toBe('1');
      expect(minimo('SESION_DIAS_SIN_EQUIPO')).toBe('1');
      expect(minimo('CAJA_TOLERANCIA_DIFERENCIA_NIO')).toBeNull();
    });

    it('la duración de la sesión no puede quedar en 0 (regla de la base)', async () => {
      await comoJefa('put', '/api/parametros/SESION_HORAS_EQUIPO')
        .send({ valor: 0 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'El parámetro SESION_HORAS_EQUIPO no puede ser menor que 1 (recibido: 0)',
        });
      await comoJefa('put', '/api/parametros/SESION_DIAS_SIN_EQUIPO')
        .send({ valor: '0.5' })
        .expect(422);
    });
  });

  describe('bitácora de cambios', () => {
    async function cambios(consulta: string): Promise<CambioAuditado[]> {
      return (await comoJefa('get', `/api/auditoria/cambios${consulta}`).expect(200)).body.cambios;
    }

    it('GET /api/auditoria/cambios: la historia de un registro, del cambio más reciente al más antiguo', async () => {
      const historia = await cambios(`?tabla=sucursal&registro_id=${ids.metro}`);
      expect(historia.map((c) => c.accion)).toEqual(['UPDATE', 'UPDATE', 'INSERT']);
      expect(historia.every((c) => c.usuario?.id === ids.jefa)).toBe(true);
      expect(historia[0]).toMatchObject({
        tabla: 'sucursal',
        registro_id: String(ids.metro),
        usuario: { id: ids.jefa, nombre_completo: 'Jefa de organización' },
        antes: { activa: true },
        despues: { activa: false },
        fecha: expect.any(String),
      });
      expect(historia[1]).toMatchObject({
        antes: { codigo: 'MET', nombre: 'Metrocentro' },
        despues: { codigo: 'MTC', nombre: 'Metrocentro Managua' },
      });
      expect(historia[2]).toMatchObject({ antes: null, despues: { codigo: 'MET' } });
    });

    it('filtra por usuario, acción y fecha, y pagina con limite y antes_de', async () => {
      const deLaJefa = await cambios(`?usuario_id=${ids.jefa}&tabla=sucursal&accion=insert`);
      expect(deLaJefa).toHaveLength(1);
      expect(deLaJefa[0].despues).toMatchObject({ codigo: 'MET' });

      const hoy = hoyEnManagua();
      expect(await cambios(`?tabla=sucursal&registro_id=${ids.metro}&desde=${hoy}`)).toHaveLength(
        3,
      );
      expect(
        await cambios(`?tabla=sucursal&registro_id=${ids.metro}&desde=${hoy}&hasta=${hoy}`),
      ).toHaveLength(3);
      expect(await cambios(`?tabla=sucursal&registro_id=${ids.metro}&hasta=2020-01-01`)).toEqual(
        [],
      );

      const filtro = `?tabla=sucursal&registro_id=${ids.metro}&limite=2`;
      const pagina1 = await cambios(filtro);
      expect(pagina1.map((c) => c.accion)).toEqual(['UPDATE', 'UPDATE']);
      const pagina2 = await cambios(`${filtro}&antes_de=${pagina1[1].id}`);
      expect(pagina2.map((c) => c.accion)).toEqual(['INSERT']);
    });

    it('los cambios de usuarios nunca muestran la contraseña', async () => {
      const deUsuario = await cambios(`?tabla=usuario&registro_id=${ids.supervisora}`);
      expect(deUsuario.length).toBeGreaterThanOrEqual(3); // creada, cambio de rol, bloqueo...
      expect(JSON.stringify(deUsuario)).not.toMatch(/password_hash|\$argon2/);
      // el desbloqueo quedó registrado a nombre de la jefa
      expect(
        deUsuario.some(
          (c) =>
            c.usuario?.id === ids.jefa &&
            (c.antes as { intentos_fallidos?: number } | null)?.intentos_fallidos === 5 &&
            (c.despues as { intentos_fallidos?: number } | null)?.intentos_fallidos === 0,
        ),
      ).toBe(true);
    });

    it('filtros inválidos → 400', async () => {
      const { body } = await comoJefa(
        'get',
        '/api/auditoria/cambios?accion=borrar&desde=ayer&limite=0',
      ).expect(400);
      expect(body.errores).toEqual([
        { campo: 'accion', mensaje: 'accion debe ser INSERT, UPDATE o DELETE' },
        { campo: 'desde', mensaje: 'desde debe ser una fecha con el formato AAAA-MM-DD' },
        { campo: 'limite', mensaje: 'limite debe ser un número entre 1 y 200' },
      ]);
    });
  });

  describe('bitácora de accesos', () => {
    async function accesos(consulta: string): Promise<AccesoRegistrado[]> {
      return (await comoJefa('get', `/api/auditoria/accesos${consulta}`).expect(200)).body.accesos;
    }

    it('GET /api/auditoria/accesos: cada intento con su resultado, motivo y equipo', async () => {
      const deSara = await accesos('?username=Sara.Supervisora');
      expect(deSara.map((a) => [a.exito, a.motivo])).toEqual([
        [true, null],
        [false, 'cuenta bloqueada'],
        [false, 'contraseña incorrecta'],
        [false, 'contraseña incorrecta'],
        [false, 'contraseña incorrecta'],
        [false, 'contraseña incorrecta'],
        [false, 'contraseña incorrecta'],
      ]);
      expect(deSara[0]).toMatchObject({
        usuario: { id: ids.supervisora, nombre_completo: 'Sara Supervisora' },
        username_intentado: 'sara.supervisora',
        equipo: { id: expect.any(String), nombre: 'Tablet de organización' },
        ip: expect.any(String),
        fecha: expect.any(String),
      });
    });

    it('filtra por usuario, resultado y fecha', async () => {
      const fallidos = await accesos(`?usuario_id=${ids.supervisora}&exito=false`);
      expect(fallidos).toHaveLength(6);
      const exitosos = await accesos(`?usuario_id=${ids.supervisora}&exito=true&limite=5`);
      expect(exitosos).toHaveLength(1);
      expect(await accesos(`?usuario_id=${ids.supervisora}&hasta=2020-01-01`)).toEqual([]);
      // también quedan los intentos con usuarios que no existen
      await login('no.existe.org', 'x').expect(401);
      const inexistente = await accesos('?username=no.existe.org');
      expect(inexistente).toEqual([
        expect.objectContaining({ usuario: null, exito: false, motivo: 'usuario inexistente' }),
      ]);
    });

    it('filtros inválidos → 400; una vendedora no ve la bitácora', async () => {
      const { body } = await comoJefa('get', '/api/auditoria/accesos?exito=quizas').expect(400);
      expect(body.errores).toEqual([{ campo: 'exito', mensaje: 'exito debe ser true o false' }]);
      for (const ruta of ['/api/auditoria/cambios', '/api/auditoria/accesos']) {
        await conSesion('get', ruta, vera.acceso).expect(403).expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere AUDITORIA_VER',
        });
      }
    });
  });
});
