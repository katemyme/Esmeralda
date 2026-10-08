import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { CajaAbierta } from '../src/caja/caja.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import type { Reporte } from '../src/reportes/reporte';
import type { VentaDetalle, VentaResumen } from '../src/ventas/ventas.service';
import { crearApp, crearUsuarioDePrueba, registrarTablet, tokenDeAcceso } from './utilidades';

// Acceso desde el celular: una sesión sin equipo registrado de quien no es administrador. Se
// consulta, se recibe, se cuenta, se solicitan devoluciones y se vende (la venta entra al turno
// abierto de su sucursal); todo lo demás —y todo lo de caja— responde 403 EQUIPO_REQUERIDO.
// Dos sucursales propias: Vera (vendedora) trabaja en la A; Nuria (encargada), en las dos.

type Metodo = 'get' | 'post' | 'put' | 'delete';

const SUC_A = 'Sucursal Celular A e2e';
const SUC_B = 'Sucursal Celular B e2e';
const CLAVE = 'Celular#2026';

const EQUIPO_REQUERIDO = {
  codigo: 'EQUIPO_REQUERIDO',
  mensaje:
    'Esto solo se puede hacer desde un equipo registrado de la sucursal (la tablet o la caja)',
};

/** Rutas sin sesión: no entran al recorrido (cerrarían la sesión o no dicen nada del celular). */
const PUBLICAS = new Set([
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
  'GET /api/equipos/actual',
  'GET /api/fotos/:archivo',
]);

/**
 * Todo lo que responde desde el celular a quien no es administrador. Una ruta nueva que no esté
 * aquí tiene que responder 403 EQUIPO_REQUERIDO: si no, la prueba del recorrido falla y hay que
 * decidir si de verdad es del celular.
 */
const DESDE_EL_CELULAR = [
  // de uso general
  'GET /api/alertas/sucursal',
  'GET /api/auth/yo',
  'GET /api/denominaciones',
  'GET /api/metodos-pago',
  'GET /api/salud',
  'GET /api/sucursales',
  'GET /api/tipo-cambio',
  'POST /api/alertas/:id/atender',
  'POST /api/auth/cambiar-password',
  // consultar productos, precios y existencias
  'GET /api/categorias',
  'GET /api/gamas',
  'GET /api/inventario/existencias',
  'GET /api/inventario/movimientos',
  'GET /api/perforaciones',
  'GET /api/perforaciones/:id',
  'GET /api/perforaciones/:id/precio-paquete',
  'GET /api/productos',
  'GET /api/productos/:id',
  'GET /api/variantes/:id/existencias',
  'GET /api/variantes/:id/historial-precios',
  'GET /api/variantes/buscar',
  // recibir envíos y contar
  'GET /api/conteos',
  'GET /api/conteos/:id',
  'GET /api/envios',
  'GET /api/envios/:id',
  'POST /api/conteos',
  'POST /api/conteos/:id/cancelar',
  'POST /api/conteos/:id/enviar',
  'POST /api/conteos/:id/registrar',
  'POST /api/envios/:id/recibir',
  // solicitar devoluciones (ejecutarlas es de la tablet)
  'GET /api/devoluciones',
  'GET /api/devoluciones/:id',
  'GET /api/devoluciones/venta',
  'POST /api/devoluciones',
  'POST /api/devoluciones/:id/cancelar',
  // vender en el turno abierto de su sucursal y ver sus ventas de ese turno
  'GET /api/caja/abiertas',
  'GET /api/promociones/disponibles',
  'GET /api/ventas',
  'GET /api/ventas/:id',
  'POST /api/ventas',
].sort();

interface Capa {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Todas las rutas que la API tiene registradas, como `GET /api/ventas/:id`. */
function rutasDeLaApi(app: NestExpressApplication): string[] {
  const express = app.getHttpAdapter().getInstance() as {
    router?: { stack: Capa[] };
    _router?: { stack: Capa[] };
  };
  const rutas = new Set<string>();
  for (const capa of (express.router ?? express._router)?.stack ?? []) {
    if (!capa.route) continue;
    for (const metodo of Object.keys(capa.route.methods)) {
      rutas.add(`${metodo.toUpperCase()} ${capa.route.path}`);
    }
  }
  return [...rutas].sort();
}

describe('Acceso desde el celular', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = {
    jefa: 0,
    vera: 0,
    nuria: 0,
    todo: 0,
    a: 0,
    b: 0,
    cajaA1: 0,
    cajaA2: 0,
    cajaB: 0,
    turnoA1: 0,
    turnoA2: 0,
    turnoB: 0,
    cadena: 0,
  };
  /** `acceso`: desde el celular (sin equipo). `enTablet`: desde la tablet de la sucursal A. */
  const jefa = { acceso: '' };
  const vera = { acceso: '', enTablet: '' };
  const nuria = { acceso: '', enTablet: '' };
  const todo = { acceso: '' };
  const venta = { celular: 0, tablet: 0, nuria: 0, caja2: 0, enB: 0 };

  function con(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function comoJefa(metodo: Metodo, ruta: string) {
    return con(metodo, ruta, jefa.acceso);
  }

  function vender(acceso: string, cuerpo: Record<string, unknown> = {}) {
    return con('post', '/api/ventas', acceso).send({
      clave_idempotencia: randomUUID(),
      items: [{ variante_id: ids.cadena, cantidad: 1 }],
      pagos: [{ metodo: 'EFECTIVO', monto: 600 }],
      ...cuerpo,
    });
  }

  async function cajasAbiertas(acceso: string): Promise<CajaAbierta[]> {
    return (await con('get', '/api/caja/abiertas', acceso).expect(200)).body.cajas;
  }

  async function ventasDe(acceso: string, consulta = ''): Promise<VentaResumen[]> {
    return (await con('get', `/api/ventas${consulta}`, acceso).expect(200)).body.ventas;
  }

  async function reporte(acceso: string, nombre: string): Promise<Reporte> {
    const { body } = await con(
      'get',
      `/api/reportes/${nombre}?sucursal_id=${ids.a}`,
      acceso,
    ).expect(200);
    return body.reporte as Reporte;
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa del celular',
      username: 'jefa.cel',
      password: CLAVE,
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.cel', CLAVE);

    for (const [codigo, nombre] of [
      ['CLA', SUC_A],
      ['CLB', SUC_B],
    ]) {
      const sucursal = await comoJefa('post', '/api/sucursales')
        .send({ codigo, nombre, direccion: `Plaza ${codigo}`, telefono: '2222-0000' })
        .expect(201);
      const sucursalId = sucursal.body.sucursal.id as number;
      const conCaja = await comoJefa('post', `/api/sucursales/${sucursalId}/cajas`)
        .send({ nombre: 'Caja 1' })
        .expect(201);
      const cajaId = conCaja.body.sucursal.cajas[0].id as number;
      if (codigo === 'CLA') Object.assign(ids, { a: sucursalId, cajaA1: cajaId });
      else Object.assign(ids, { b: sucursalId, cajaB: cajaId });
    }
    const tablet = await registrarTablet(app, jefa.acceso, 'Tablet CLA', ids.a);

    // Un rol con todos los permisos que no es el administrador: lo que no pase desde su celular
    // es porque pide el equipo, no porque le falte el permiso
    const permisos = await bd.db.selectFrom('permiso').select('codigo').execute();
    const todos = permisos.map((p) => p.codigo);
    await comoJefa('post', '/api/roles')
      .send({ codigo: 'TODO_CEL', nombre: 'Todo menos el equipo e2e' })
      .expect(201);
    await comoJefa('put', '/api/roles/TODO_CEL/permisos').send({ permisos: todos }).expect(200);

    const actores: [string, string, string, number[]][] = [
      ['Vera Celular', 'vera.cel', 'VENDEDOR', [ids.a]],
      ['Nuria Celular', 'nuria.cel', 'ENCARGADO', [ids.a, ids.b]],
      ['Tomás Celular', 'todo.cel', 'TODO_CEL', [ids.a]],
    ];
    for (const [nombre, username, rol, sucursales] of actores) {
      const id = await crearUsuarioDePrueba(app, {
        nombre,
        username,
        password: CLAVE,
        rol,
        sucursales,
      });
      Object.assign(ids, { [username.split('.')[0]]: id });
    }
    vera.acceso = await tokenDeAcceso(app, 'vera.cel', CLAVE);
    vera.enTablet = await tokenDeAcceso(app, 'vera.cel', CLAVE, tablet);
    nuria.acceso = await tokenDeAcceso(app, 'nuria.cel', CLAVE);
    nuria.enTablet = await tokenDeAcceso(app, 'nuria.cel', CLAVE, tablet);
    todo.acceso = await tokenDeAcceso(app, 'todo.cel', CLAVE);

    // Un producto que se puede devolver, con existencias en las dos sucursales
    const categoria = await comoJefa('post', '/api/categorias')
      .send({ nombre: 'Regalos CEL' })
      .expect(201);
    await comoJefa('put', `/api/categorias/${categoria.body.categoria.id}/admite-devolucion`)
      .send({ admite_devolucion: true })
      .expect(200);
    const producto = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: categoria.body.categoria.id,
        nombre: 'Regalo CEL',
        variantes: [{ sku: 'CEL-CAD', nombre: 'Cadena', precio_venta: 600, costo: 200 }],
      })
      .expect(201);
    ids.cadena = (producto.body.producto as ProductoCatalogo).variantes[0].id;
    for (const sucursal of [ids.a, ids.b]) {
      await comoJefa('post', '/api/inventario/movimientos')
        .send({
          sucursal_id: sucursal,
          variante_id: ids.cadena,
          tipo: 'AJUSTE_POSITIVO',
          cantidad: 10,
          motivo: 'Existencias para las pruebas del celular',
        })
        .expect(201);
    }
    const tipoCambio = await comoJefa('get', '/api/tipo-cambio').expect(200);
    if (!tipoCambio.body.tipo_cambio) {
      await comoJefa('put', '/api/tipo-cambio')
        .send({ usd_a_nio: 36.62, confirmar: true })
        .expect(200);
    }
  });

  afterAll(async () => {
    // El rol de la prueba no queda en la base: primero se le quita a su único usuario
    await bd.transaccion(ids.jefa, (trx) =>
      sql`select fn_actualizar_usuario(${ids.jefa}, ${ids.todo}, 'Tomás Celular', 'VENDEDOR',
                 ${[ids.a]}::integer[])`.execute(trx),
    );
    await comoJefa('delete', '/api/roles/TODO_CEL').expect(204);
    await app.close();
  });

  describe('la sesión', () => {
    it('quien no es administrador entra sin equipo registrado, con el acceso del celular', async () => {
      const { body } = await con('get', '/api/auth/yo', vera.acceso).expect(200);
      expect(body).toMatchObject({ equipo: null, acceso: 'CELULAR' });
      expect(body.usuario.permisos).toEqual([
        'DEVOLUCIONES_REGISTRAR',
        'INVENTARIO_CONTAR',
        'INVENTARIO_RECIBIR',
        'INVENTARIO_VER',
        'PRODUCTOS_VER',
        'VENTAS_MODIFICAR_PRECIO',
        'VENTAS_PROMOCION',
        'VENTAS_REGISTRAR',
        'VENTAS_VER_PROPIAS',
      ]);
      // la encargada tiene más permisos, pero desde su celular valen los mismos
      const deNuria = await con('get', '/api/auth/yo', nuria.acceso).expect(200);
      expect(deNuria.body.usuario.permisos).toEqual(body.usuario.permisos);
      expect(deNuria.body.usuario.sucursales.map((s: { codigo: string }) => s.codigo)).toEqual([
        'CLA',
        'CLB',
      ]);
    });

    it('la misma persona, en la tablet de su sucursal, tiene todo lo de su rol', async () => {
      const { body } = await con('get', '/api/auth/yo', nuria.enTablet).expect(200);
      expect(body.acceso).toBe('COMPLETO');
      expect(body.equipo).toMatchObject({ nombre: 'Tablet CLA' });
      expect(body.usuario.permisos).toEqual(
        expect.arrayContaining(['CAJA_ABRIR', 'VENTAS_ANULAR', 'VENTAS_VER_TODAS', 'REPORTES_VER']),
      );
    });

    it('el administrador sin equipo sigue con todo', async () => {
      const { body } = await con('get', '/api/auth/yo', jefa.acceso).expect(200);
      expect(body).toMatchObject({ equipo: null, acceso: 'COMPLETO' });
      expect(body.usuario.permisos).toContain('CAJA_CIERRE_FORZADO');
    });
  });

  describe('lo que se consulta y lo que no', () => {
    it('desde el celular: productos, existencias, envíos, conteos, devoluciones y los avisos', async () => {
      for (const ruta of [
        '/api/productos',
        `/api/inventario/existencias?sucursal_id=${ids.a}`,
        '/api/envios',
        '/api/conteos',
        '/api/devoluciones',
        '/api/alertas/sucursal',
        '/api/sucursales',
        '/api/tipo-cambio',
        '/api/metodos-pago',
      ]) {
        await con('get', ruta, vera.acceso).expect(200);
      }
    });

    it('lo de la caja, anular, las mermas, los reportes y el tipo de cambio piden el equipo', async () => {
      const intentos: [Metodo, string, Record<string, unknown>?][] = [
        ['get', '/api/caja/turno'],
        ['post', '/api/caja/turno/abrir', { inicial_nio: 500 }],
        ['post', '/api/caja/turno/cerrar', { efectivo: [] }],
        ['get', '/api/caja/turno/movimientos'],
        ['post', '/api/caja/turno/movimientos', { tipo: 'EGRESO', moneda: 'NIO', monto: 50 }],
        ['post', '/api/ventas/1/anular', { motivo: 'Desde el celular no' }],
        ['post', '/api/ventas/1/imprimir'],
        ['post', '/api/devoluciones/1/ejecutar', {}],
        ['post', '/api/devoluciones/1/imprimir'],
        ['put', '/api/tipo-cambio', { usd_a_nio: 36.7 }],
        ['post', '/api/mermas', { sucursal_id: ids.a, variante_id: ids.cadena, cantidad: 1 }],
        ['get', '/api/mermas'],
        ['get', '/api/reportes/ventas'],
        ['get', '/api/reportes/cierres'],
        ['get', '/api/turnos'],
      ];
      for (const [metodo, ruta, cuerpo] of intentos) {
        await con(metodo, ruta, nuria.acceso).send(cuerpo).expect(403).expect(EQUIPO_REQUERIDO);
      }
      // En la tablet sí (aquí, sin turno abierto todavía)
      await con('get', '/api/caja/turno', nuria.enTablet).expect(200).expect({ turno: null });
      await con('get', '/api/reportes/ventas', nuria.enTablet).expect(200);
    });

    it('el permiso que su rol no tiene se le niega igual que siempre', async () => {
      await con('post', '/api/ventas/1/anular', vera.acceso)
        .send({ motivo: 'No tengo ese permiso' })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere VENTAS_ANULAR',
        });
      await con('get', '/api/usuarios', vera.acceso).expect(403).expect({
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere USUARIOS_VER',
      });
    });
  });

  describe('vender desde el celular', () => {
    it('sin turno abierto en su sucursal no hay dónde vender', async () => {
      expect(await cajasAbiertas(vera.acceso)).toEqual([]);
      await vender(vera.acceso).expect(409).expect({
        codigo: 'SIN_TURNO_ABIERTO',
        mensaje: 'La caja no tiene un turno abierto: ábrala primero',
      });
    });

    it('la venta entra al turno abierto, con las reglas de siempre, y queda a su nombre', async () => {
      const turno = await con('post', '/api/caja/turno/abrir', vera.enTablet)
        .send({ inicial_nio: 500 })
        .expect(201);
      ids.turnoA1 = turno.body.turno.id;
      expect(await cajasAbiertas(vera.acceso)).toEqual([
        {
          turno_id: ids.turnoA1,
          caja: { id: ids.cajaA1, nombre: 'Caja 1' },
          sucursal: { id: ids.a, codigo: 'CLA', nombre: SUC_A },
        },
      ]);

      // Cobra C$50 más que el precio establecido y recibe C$1000: el vuelto lo calcula la base
      const clave = randomUUID();
      const cuerpo = {
        clave_idempotencia: clave,
        items: [{ variante_id: ids.cadena, cantidad: 1, precio: 650 }],
        pagos: [{ metodo: 'EFECTIVO', monto: 1000 }],
      };
      const { body } = await vender(vera.acceso, cuerpo).expect(201);
      const hecha = body.venta as VentaDetalle;
      expect(hecha).toMatchObject({
        numero: 'CLA-00000001',
        turno_id: ids.turnoA1,
        vendedor: { id: ids.vera, nombre_completo: 'Vera Celular' },
        caja: { id: ids.cajaA1, nombre: 'Caja 1' },
        total: '650.00',
        vuelto: '350.00',
        origen: null, // desde dónde se vendió no lo ve la vendedora
      });
      venta.celular = hecha.id;

      // Reintento con la misma clave (la red del celular falla más): la misma venta, sin duplicar
      const repetida = await vender(vera.acceso, cuerpo).expect(200);
      expect(repetida.body).toMatchObject({ repetida: true, venta: { id: venta.celular } });
      // No baja del precio establecido, tampoco desde el celular
      await vender(vera.acceso, { items: [{ variante_id: ids.cadena, cantidad: 1, precio: 500 }] })
        .expect(422)
        .expect((r) => expect(r.body.codigo).toBe('REGLA_NEGOCIO'));
    });

    it('cada venta guarda desde dónde se hizo, y solo el administrador lo ve', async () => {
      venta.tablet = (await vender(vera.enTablet).expect(201)).body.venta.id;
      venta.nuria = (await vender(nuria.enTablet).expect(201)).body.venta.id;
      const origenDe = async (id: number, acceso: string): Promise<string | null> =>
        (await con('get', `/api/ventas/${id}`, acceso).expect(200)).body.venta.origen;
      expect(await origenDe(venta.celular, jefa.acceso)).toBe('CELULAR');
      expect(await origenDe(venta.tablet, jefa.acceso)).toBe('EQUIPO');
      expect(await origenDe(venta.celular, nuria.enTablet)).toBeNull();
      const lista = await ventasDe(jefa.acceso, `?sucursal_id=${ids.a}`);
      expect(lista.map((v) => [v.id, v.origen])).toEqual([
        [venta.nuria, 'EQUIPO'],
        [venta.tablet, 'EQUIPO'],
        [venta.celular, 'CELULAR'],
      ]);
    });

    it('desde el celular solo ve sus ventas del turno abierto, sin totales', async () => {
      const respuesta = await con('get', '/api/ventas', vera.acceso).expect(200);
      expect(Object.keys(respuesta.body)).toEqual(['ventas']); // la lista no trae sumas
      expect((respuesta.body.ventas as VentaResumen[]).map((v) => v.id)).toEqual([
        venta.tablet,
        venta.celular,
      ]);
      await con('get', `/api/ventas/${venta.nuria}`, vera.acceso).expect(404);

      // La encargada ve todas las de su sucursal en la tablet; desde su celular, solo las suyas
      expect((await ventasDe(nuria.enTablet)).map((v) => v.id)).toEqual([
        venta.nuria,
        venta.tablet,
        venta.celular,
      ]);
      expect((await ventasDe(nuria.acceso)).map((v) => v.id)).toEqual([venta.nuria]);
      await con('get', `/api/ventas/${venta.celular}`, nuria.acceso).expect(404);
    });

    it('anular es de la tablet: desde el celular la venta sigue como estaba', async () => {
      await con('post', `/api/ventas/${venta.nuria}/anular`, nuria.acceso)
        .send({ motivo: 'Me equivoqué de producto' })
        .expect(403)
        .expect(EQUIPO_REQUERIDO);
      const sigue = await con('get', `/api/ventas/${venta.nuria}`, nuria.acceso).expect(200);
      expect(sigue.body.venta.estado).toBe('COMPLETADA');
    });

    it('con varias cajas abiertas elige la caja; quien trabaja en dos sucursales, también la sucursal', async () => {
      const conCaja2 = await comoJefa('post', `/api/sucursales/${ids.a}/cajas`)
        .send({ nombre: 'Caja 2' })
        .expect(201);
      ids.cajaA2 = (conCaja2.body.sucursal.cajas as { id: number; nombre: string }[]).find(
        (c) => c.nombre === 'Caja 2',
      )!.id;
      const abrir = async (caja: number): Promise<number> =>
        (
          await comoJefa('post', '/api/caja/turno/abrir')
            .send({ inicial_nio: 300, caja_id: caja })
            .expect(201)
        ).body.turno.id;
      ids.turnoA2 = await abrir(ids.cajaA2);
      ids.turnoB = await abrir(ids.cajaB);

      expect((await cajasAbiertas(vera.acceso)).map((c) => c.caja.id)).toEqual([
        ids.cajaA1,
        ids.cajaA2,
      ]);
      expect(
        (await cajasAbiertas(nuria.acceso)).map((c) => [c.sucursal.codigo, c.caja.id]),
      ).toEqual([
        ['CLA', ids.cajaA1],
        ['CLA', ids.cajaA2],
        ['CLB', ids.cajaB],
      ]);

      await vender(vera.acceso).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'Hay más de una caja abierta: indique en cuál entra la venta',
      });
      const enCaja2 = await vender(vera.acceso, { caja_id: ids.cajaA2 }).expect(201);
      expect(enCaja2.body.venta).toMatchObject({ turno_id: ids.turnoA2, numero: 'CLA-00000004' });
      venta.caja2 = enCaja2.body.venta.id;
      // la caja de una sucursal que no es suya
      await vender(vera.acceso, { caja_id: ids.cajaB }).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'Esa caja no tiene un turno abierto en una de sus sucursales',
      });
      const enB = await vender(nuria.acceso, { caja_id: ids.cajaB }).expect(201);
      expect(enB.body.venta).toMatchObject({ turno_id: ids.turnoB, numero: 'CLB-00000001' });
      venta.enB = enB.body.venta.id;
    });
  });

  describe('reportes y cierre: el origen, solo para el administrador', () => {
    it('el reporte de ventas dice cuánto se vendió desde los equipos y cuánto desde celulares', async () => {
      const r = await reporte(jefa.acceso, 'ventas');
      expect(r.secciones.map((s) => s.clave)).toEqual(['ventas', 'origen']);
      const porOrigen = r.secciones[1];
      expect(porOrigen.titulo).toBe('Desde dónde se vendió');
      expect(porOrigen.filas.map((f) => [f.origen, f.ventas, f.venta_neta])).toEqual([
        ['Equipo de la sucursal', 2, '1200.00'],
        ['Celular', 2, '1250.00'],
      ]);
      expect(porOrigen.totales).toMatchObject({ ventas: 4, venta_neta: '2450.00' });

      // La encargada ve el mismo reporte sin esa sección
      const deNuria = await reporte(nuria.enTablet, 'ventas');
      expect(deNuria.secciones.map((s) => s.clave)).toEqual(['ventas']);
      expect(deNuria.secciones[0].totales).toMatchObject({ ventas: 4 });
    });

    it('cerrados los turnos, el reporte de cierres cuenta las ventas que llegaron de un celular', async () => {
      for (const turno of [ids.turnoA1, ids.turnoA2, ids.turnoB]) {
        await comoJefa('post', `/api/turnos/${turno}/cierre-forzado`)
          .send({ motivo: 'Cierre de las pruebas del celular' })
          .expect(200);
      }
      const cierres = (await reporte(jefa.acceso, 'cierres')).secciones.find(
        (s) => s.clave === 'cierres',
      )!;
      expect(cierres.columnas.map((c) => c.clave)).toContain('ventas_celular');
      expect(cierres.filas.map((f) => [f.caja, f.ventas, f.ventas_celular])).toEqual([
        ['Caja 1', 3, 1],
        ['Caja 2', 1, 1],
      ]);
      expect(cierres.totales).toMatchObject({ ventas: 4, ventas_celular: 2 });

      const deNuria = (await reporte(nuria.enTablet, 'cierres')).secciones.find(
        (s) => s.clave === 'cierres',
      )!;
      expect(deNuria.columnas.map((c) => c.clave)).not.toContain('ventas_celular');
      expect(deNuria.filas.every((f) => !('ventas_celular' in f))).toBe(true);
    });

    it('con el turno cerrado, desde el celular ya no se ven esas ventas (en la tablet, sí)', async () => {
      expect(await ventasDe(vera.acceso)).toEqual([]);
      await con('get', `/api/ventas/${venta.celular}`, vera.acceso).expect(404);
      expect((await ventasDe(vera.enTablet)).map((v) => v.id)).toEqual([
        venta.caja2,
        venta.tablet,
        venta.celular,
      ]);
    });
  });

  describe('solicitar una devolución desde el celular', () => {
    const solicitud = { vera: 0, nuria: 0 };

    function solicitar(acceso: string, ventaId: number, cuerpo: Record<string, unknown> = {}) {
      return con('get', `/api/ventas/${ventaId}`, jefa.acceso)
        .expect(200)
        .then((r) =>
          con('post', '/api/devoluciones', acceso).send({
            venta_id: ventaId,
            tipo: 'DEVOLUCION',
            motivo: 'No le gustó la cadena',
            cliente_nombre: 'Carla Cliente',
            cliente_telefono: '8888-1234',
            lineas: [
              {
                detalle_id: (r.body.venta as VentaDetalle).lineas[0].id,
                cantidad: 1,
                estado: 'BUENO',
              },
            ],
            ...cuerpo,
          }),
        );
    }

    async function sucursalDe(devolucionId: number): Promise<number> {
      const fila = await bd.db
        .selectFrom('devolucion')
        .select('sucursal_solicitud_id')
        .where('id', '=', devolucionId)
        .executeTakeFirstOrThrow();
      return fila.sucursal_solicitud_id;
    }

    it('busca la factura y la solicita: la sucursal es la suya, o la que elija entre las suyas', async () => {
      const buscada = await con(
        'get',
        '/api/devoluciones/venta?numero=CLA-00000001',
        vera.acceso,
      ).expect(200);
      expect(buscada.body.venta).toMatchObject({ id: venta.celular, motivo_no: null });

      const deVera = await solicitar(vera.acceso, venta.celular);
      expect(deVera.status).toBe(201);
      solicitud.vera = deVera.body.devolucion.id;
      expect(await sucursalDe(solicitud.vera)).toBe(ids.a);

      // Nuria trabaja en las dos: dice en cuál está el cliente
      const deNuria = await solicitar(nuria.acceso, venta.tablet, { sucursal_id: ids.b });
      expect(deNuria.status).toBe(201);
      solicitud.nuria = deNuria.body.devolucion.id;
      expect(await sucursalDe(solicitud.nuria)).toBe(ids.b);
      // y Vera no puede pedirla a nombre de una sucursal que no es suya
      const ajena = await solicitar(vera.acceso, venta.caja2, { sucursal_id: ids.b });
      expect(ajena.status).toBe(403);
    });

    it('ejecutarla es de la tablet; cancelar la suya, también desde el celular', async () => {
      await comoJefa('post', `/api/devoluciones/${solicitud.vera}/resolver`)
        .send({ aprobar: true })
        .expect(200);
      await con('post', `/api/devoluciones/${solicitud.vera}/ejecutar`, vera.acceso)
        .send({})
        .expect(403)
        .expect(EQUIPO_REQUERIDO);
      for (const [id, acceso] of [
        [solicitud.vera, vera.acceso],
        [solicitud.nuria, nuria.acceso],
      ] as const) {
        const cancelada = await con('post', `/api/devoluciones/${id}/cancelar`, acceso)
          .send({ motivo: 'El cliente se la quedó' })
          .expect(200);
        expect(cancelada.body.devolucion.estado).toBe('CANCELADA');
      }
    });
  });

  describe('todas las rutas de la API', () => {
    it('desde el celular solo responde la lista: lo demás pide el equipo, aunque tenga el permiso', async () => {
      const rutas = rutasDeLaApi(app).filter((r) => !PUBLICAS.has(r));
      expect(rutas.length).toBeGreaterThan(120);

      const responden: string[] = [];
      for (const ruta of rutas) {
        const [metodo, camino] = ruta.split(' ');
        const url = camino
          .replace(/:id\b/g, '999999999')
          .replace(/:(codigo|clave)\b/g, 'NO_EXISTE')
          .replace(/:\w+/g, 'x');
        // Tomás tiene todos los permisos: lo único que le falta es estar en un equipo registrado
        const r = await con(metodo.toLowerCase() as Metodo, url, todo.acceso);
        if (r.status === 403 && r.body.codigo === 'EQUIPO_REQUERIDO') continue;
        responden.push(ruta);
      }
      expect(responden).toEqual(DESDE_EL_CELULAR);
    });

    it('y nada de lo que mueve dinero está en esa lista, salvo vender', () => {
      const deDinero = DESDE_EL_CELULAR.filter((r) =>
        /\/(caja\/turno|turnos|anular|ejecutar|transferencia|tipo-cambio|imprimir)/.test(r),
      );
      expect(deDinero).toEqual(['GET /api/tipo-cambio']); // consultarlo, no registrarlo
      expect(DESDE_EL_CELULAR).toContain('POST /api/ventas');
    });
  });
});
