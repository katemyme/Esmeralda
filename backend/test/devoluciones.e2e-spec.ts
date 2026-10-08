import type { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AlertaAdmin, ListaAlertas } from '../src/alertas/alertas.service';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { TicketCierre, TurnoDetalle } from '../src/caja/caja.service';
import type {
  DevolucionDetalle,
  DevolucionResumen,
  VentaParaDevolver,
} from '../src/devoluciones/devoluciones.service';
import type { Existencia, Movimiento } from '../src/inventario/inventario.service';
import type { Merma } from '../src/mermas/mermas.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import { hoyEnManagua, sumarDias } from '../src/reportes/periodo';
import type { Reporte, Seccion } from '../src/reportes/reporte';
import { TareasService } from '../src/tareas/tareas.service';
import type { VentaDetalle } from '../src/ventas/ventas.service';
import {
  comoBytes,
  cookiePuesta,
  crearApp,
  crearUsuarioDePrueba,
  tokenDeAcceso,
} from './utilidades';

// Devoluciones y cambios (B8) de punta a punta, en dos sucursales propias: se vende en la A y se
// devuelve en la A o en la B. Cinco ventas en un turno que se cierra (la devolución es para turnos
// cerrados) y después las solicitudes, su aprobación y su ejecución en caja. Las pruebas van en
// orden y comparten estado.
//   V1 cadena C$600 + perfume C$400 con promoción del 10 % → C$900 en efectivo
//   V2 tres perfumes (C$1200): C$400 en efectivo y C$800 con tarjeta
//   V3 un aro de piercing (no se devuelve)
//   V4 una cadena con tarjeta          V5 una cadena en efectivo

type Metodo = 'get' | 'post' | 'put';

const SUC_A = 'Sucursal Devoluciones A e2e';
const SUC_B = 'Sucursal Devoluciones B e2e';

describe('Devoluciones y cambios', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const hoy = hoyEnManagua();
  const ids = {
    jefa: 0,
    dora: 0,
    elsa: 0,
    beto: 0,
    nora: 0,
    a: 0,
    b: 0,
    cajaA: 0,
    cajaB: 0,
    regalos: 0,
    piezas: 0,
    promocion: 0,
    turnoA: 0,
    turnoA2: 0,
    turnoB: 0,
  };
  const pieza = { cadena: 0, perfume: 0, aro: 0 };
  /** La jefa (admin, sin equipo), Dora (vendedora) y Elsa (encargada) en la PC de caja de la A,
   *  Beto (vendedor) en la PC de caja de la B y Nora (un rol sin permisos de devoluciones). */
  const jefa = { acceso: '' };
  const dora = { acceso: '' };
  const elsa = { acceso: '' };
  const beto = { acceso: '' };
  const nora = { acceso: '' };
  const venta = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0 };
  const linea = { v1Cadena: 0, v1Perfume: 0, v2Perfume: 0, v3Aro: 0, v4Cadena: 0, v5Cadena: 0 };
  const dev = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0 };
  const cambio = { clave: randomUUID(), venta: 0 };

  const CLIENTE = { cliente_nombre: 'Carla Cliente', cliente_telefono: '8888-1234' };

  function con(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function comoJefa(metodo: Metodo, ruta: string) {
    return con(metodo, ruta, jefa.acceso);
  }

  function vender(acceso: string, cuerpo: Record<string, unknown>) {
    return con('post', '/api/ventas', acceso)
      .send({ clave_idempotencia: randomUUID(), ...cuerpo })
      .expect(201);
  }

  /** La solicitud tal como la manda la pantalla: lo demás lo pone la base. */
  function solicitar(acceso: string, cuerpo: Record<string, unknown>) {
    return con('post', '/api/devoluciones', acceso).send({ ...CLIENTE, ...cuerpo });
  }

  async function ver(acceso: string, id: number): Promise<DevolucionDetalle> {
    const { body } = await con('get', `/api/devoluciones/${id}`, acceso).expect(200);
    return body.devolucion as DevolucionDetalle;
  }

  async function buscarVenta(acceso: string, numero: string): Promise<VentaParaDevolver> {
    const { body } = await con('get', `/api/devoluciones/venta?numero=${numero}`, acceso).expect(
      200,
    );
    return body.venta as VentaParaDevolver;
  }

  async function aprobar(id: number): Promise<DevolucionDetalle> {
    const { body } = await comoJefa('post', `/api/devoluciones/${id}/resolver`)
      .send({ aprobar: true })
      .expect(200);
    return body.devolucion as DevolucionDetalle;
  }

  async function stock(sucursalId: number, varianteId: number): Promise<number | null | undefined> {
    const { body } = await comoJefa(
      'get',
      `/api/inventario/existencias?sucursal_id=${sucursalId}&buscar=DVE-`,
    ).expect(200);
    return (body.existencias as Existencia[]).find((e) => e.variante.id === varianteId)?.cantidad;
  }

  async function alertas(tipo: string, estado = 'pendientes'): Promise<AlertaAdmin[]> {
    const { body } = await comoJefa(
      'get',
      `/api/alertas?tipo=${tipo}&sucursal_id=${ids.a}&estado=${estado}`,
    ).expect(200);
    return body.alertas as AlertaAdmin[];
  }

  /** Los avisos para la sucursal de quien pregunta (no son los del panel). */
  async function alertasDeSucursal(acceso: string, consulta = ''): Promise<ListaAlertas> {
    const { body } = await con('get', `/api/alertas/sucursal${consulta}`, acceso).expect(200);
    return body as ListaAlertas;
  }

  /** Lo esperado en efectivo (C$) de un turno: solo lo ve quien tiene CAJA_VER_DIFERENCIAS. */
  async function esperadoEnCaja(turnoId: number): Promise<string | undefined> {
    const { body } = await comoJefa('get', `/api/turnos/${turnoId}`).expect(200);
    const turno = body.turno as TurnoDetalle;
    expect(turno.arqueo.map((a) => a.metodo.codigo)).not.toContain('SALDO_CAMBIO');
    return turno.arqueo.find((a) => a.metodo.codigo === 'EFECTIVO' && a.moneda === 'NIO')?.esperado;
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de devoluciones',
      username: 'jefa.dve',
      password: 'Devolver#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.dve', 'Devolver#2026');

    // Dos sucursales, cada una con su caja y su PC de caja
    const equipos: Record<string, string> = {};
    for (const [codigo, nombre] of [
      ['DEA', SUC_A],
      ['DEB', SUC_B],
    ]) {
      const sucursal = await comoJefa('post', '/api/sucursales')
        .send({ codigo, nombre, direccion: `Plaza ${codigo}`, telefono: '2222-0000' })
        .expect(201);
      const sucursalId = sucursal.body.sucursal.id as number;
      const conCaja = await comoJefa('post', `/api/sucursales/${sucursalId}/cajas`)
        .send({ nombre: 'Caja 1' })
        .expect(201);
      const cajaId = conCaja.body.sucursal.cajas[0].id as number;
      const equipo = await comoJefa('post', '/api/equipos')
        .send({
          nombre: `PC de caja ${codigo}`,
          tipo: 'CAJA',
          sucursal_id: sucursalId,
          caja_id: cajaId,
        })
        .expect(201);
      equipos[codigo] = cookiePuesta(equipo, 'esmeralda_equipo')?.valor ?? '';
      if (codigo === 'DEA') Object.assign(ids, { a: sucursalId, cajaA: cajaId });
      else Object.assign(ids, { b: sucursalId, cajaB: cajaId });
    }

    // Un rol que vende y ve reportes, pero no registra devoluciones ni ve las diferencias de caja
    await comoJefa('post', '/api/roles')
      .send({ codigo: 'CAJERO_DVE', nombre: 'Cajero sin devoluciones e2e' })
      .expect(201);
    await comoJefa('put', '/api/roles/CAJERO_DVE/permisos')
      .send({ permisos: ['VENTAS_REGISTRAR', 'VENTAS_VER_PROPIAS', 'REPORTES_VER'] })
      .expect(200);

    const actores: [string, string, string, number, string, { acceso: string }][] = [
      ['Dora Devoluciones', 'dora.dve', 'VENDEDOR', ids.a, 'DEA', dora],
      ['Elsa Devoluciones', 'elsa.dve', 'ENCARGADO', ids.a, 'DEA', elsa],
      ['Beto Devoluciones', 'beto.dve', 'VENDEDOR', ids.b, 'DEB', beto],
      ['Nora Devoluciones', 'nora.dve', 'CAJERO_DVE', ids.a, 'DEA', nora],
    ];
    for (const [nombre, username, rol, sucursal, equipo, sesion] of actores) {
      const id = await crearUsuarioDePrueba(app, {
        nombre,
        username,
        password: 'Devolver#2026',
        rol,
        sucursales: [sucursal],
      });
      Object.assign(ids, { [username.split('.')[0]]: id });
      sesion.acceso = await tokenDeAcceso(app, username, 'Devolver#2026', equipos[equipo]);
    }

    // Catálogo propio: regalos (se devuelven) y piezas de piercing (no)
    for (const [clave, nombre] of [
      ['regalos', 'Regalos DVE'],
      ['piezas', 'Piezas DVE'],
    ]) {
      const categoria = await comoJefa('post', '/api/categorias').send({ nombre }).expect(201);
      Object.assign(ids, { [clave]: categoria.body.categoria.id });
    }
    await comoJefa('put', `/api/categorias/${ids.regalos}/admite-devolucion`)
      .send({ admite_devolucion: true })
      .expect(200);
    const regalo = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: ids.regalos,
        nombre: 'Regalo DVE',
        variantes: [
          { sku: 'DVE-CAD', nombre: 'Cadena', precio_venta: 600, costo: 200 },
          { sku: 'DVE-PERF', nombre: 'Perfume', precio_venta: 400, costo: 150 },
        ],
      })
      .expect(201);
    const variantes = (regalo.body.producto as ProductoCatalogo).variantes;
    pieza.cadena = variantes.find((v) => v.sku === 'DVE-CAD')?.id ?? 0;
    pieza.perfume = variantes.find((v) => v.sku === 'DVE-PERF')?.id ?? 0;
    const piercing = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: ids.piezas,
        nombre: 'Piercing DVE',
        variantes: [{ sku: 'DVE-ARO', nombre: 'Aro', precio_venta: 250, costo: 80 }],
      })
      .expect(201);
    pieza.aro = (piercing.body.producto as ProductoCatalogo).variantes[0].id;
    for (const [variante, cantidad] of [
      [pieza.cadena, 10],
      [pieza.perfume, 10],
      [pieza.aro, 5],
    ]) {
      await comoJefa('post', '/api/inventario/movimientos')
        .send({
          sucursal_id: ids.a,
          variante_id: variante,
          tipo: 'AJUSTE_POSITIVO',
          cantidad,
          motivo: 'Existencias para las pruebas de devoluciones',
        })
        .expect(201);
    }
    const promocion = await comoJefa('post', '/api/promociones')
      .send({ nombre: 'Promo DVE', tipo: 'PORCENTAJE', valor: 10 })
      .expect(201);
    ids.promocion = promocion.body.promocion.id;
    await comoJefa('put', `/api/promociones/${ids.promocion}/activa`)
      .send({ activa: true })
      .expect(200);

    // El día de ventas en la sucursal A
    const turno = await con('post', '/api/caja/turno/abrir', dora.acceso)
      .send({ inicial_nio: 1000 })
      .expect(201);
    ids.turnoA = turno.body.turno.id;
    const lineaDe = (v: VentaDetalle, variante: number) =>
      v.lineas.find((l) => l.variante.id === variante)?.id ?? 0;
    const v1 = (
      await vender(dora.acceso, {
        items: [
          { variante_id: pieza.cadena, cantidad: 1 },
          { variante_id: pieza.perfume, cantidad: 1 },
        ],
        pagos: [{ metodo: 'EFECTIVO', monto: 900 }],
        promocion_id: ids.promocion,
      })
    ).body.venta as VentaDetalle;
    const v2 = (
      await vender(dora.acceso, {
        items: [{ variante_id: pieza.perfume, cantidad: 3 }],
        pagos: [
          { metodo: 'EFECTIVO', monto: 400 },
          { metodo: 'TARJETA', monto: 800, referencia: 'V-800' },
        ],
      })
    ).body.venta as VentaDetalle;
    const v3 = (
      await vender(dora.acceso, {
        items: [{ variante_id: pieza.aro, cantidad: 1 }],
        pagos: [{ metodo: 'EFECTIVO', monto: 250 }],
      })
    ).body.venta as VentaDetalle;
    const v4 = (
      await vender(dora.acceso, {
        items: [{ variante_id: pieza.cadena, cantidad: 1 }],
        pagos: [{ metodo: 'TARJETA', monto: 600, referencia: 'V-600' }],
      })
    ).body.venta as VentaDetalle;
    const v5 = (
      await vender(dora.acceso, {
        items: [{ variante_id: pieza.cadena, cantidad: 1 }],
        pagos: [{ metodo: 'EFECTIVO', monto: 600 }],
      })
    ).body.venta as VentaDetalle;
    Object.assign(venta, { v1: v1.id, v2: v2.id, v3: v3.id, v4: v4.id, v5: v5.id });
    Object.assign(linea, {
      v1Cadena: lineaDe(v1, pieza.cadena),
      v1Perfume: lineaDe(v1, pieza.perfume),
      v2Perfume: lineaDe(v2, pieza.perfume),
      v3Aro: lineaDe(v3, pieza.aro),
      v4Cadena: lineaDe(v4, pieza.cadena),
      v5Cadena: lineaDe(v5, pieza.cadena),
    });
    await comoJefa('put', `/api/promociones/${ids.promocion}/activa`)
      .send({ activa: false })
      .expect(200);
  });

  afterAll(async () => {
    // Las otras pruebas esperan solo los roles del sistema: el de esta prueba se elimina
    await comoJefa('put', `/api/usuarios/${ids.nora}`)
      .send({ nombre_completo: 'Nora Devoluciones', rol: 'VENDEDOR', sucursales: [ids.a] })
      .expect(200);
    await request(http)
      .delete('/api/roles/CAJERO_DVE')
      .set('Authorization', `Bearer ${jefa.acceso}`)
      .expect(204);
    await app.close();
  });

  it('sin sesión → 401; sin permisos de devoluciones → 403', async () => {
    // las rutas que sirven a la sucursal y al administrador piden uno de los dos permisos
    const cualquiera = 'DEVOLUCIONES_REGISTRAR o DEVOLUCIONES_APROBAR';
    const rutas: [Metodo, string, string][] = [
      ['get', '/api/devoluciones', cualquiera],
      ['get', '/api/devoluciones/venta?numero=DEA-1', cualquiera],
      ['get', '/api/devoluciones/1', cualquiera],
      ['post', '/api/devoluciones', 'DEVOLUCIONES_REGISTRAR'],
      ['post', '/api/devoluciones/1/resolver', 'DEVOLUCIONES_APROBAR'],
      ['post', '/api/devoluciones/1/cancelar', cualquiera],
      ['post', '/api/devoluciones/1/ejecutar', 'DEVOLUCIONES_REGISTRAR'],
      ['post', '/api/devoluciones/1/transferencia', 'DEVOLUCIONES_APROBAR'],
      ['post', '/api/devoluciones/1/imprimir', cualquiera],
    ];
    for (const [metodo, ruta, permiso] of rutas) {
      await request(http)[metodo](ruta).expect(401);
      await con(metodo, ruta, nora.acceso)
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: `Permiso denegado: se requiere ${permiso}`,
        });
    }
    // aprobar y anotar transferencias es solo del administrador: ni la encargada
    for (const ruta of ['resolver', 'transferencia']) {
      const { body } = await con('post', `/api/devoluciones/1/${ruta}`, elsa.acceso).expect(403);
      expect(body.mensaje).toBe('Permiso denegado: se requiere DEVOLUCIONES_APROBAR');
    }
  });

  describe('buscar la factura', () => {
    it('el ticket de la venta lleva el número de factura para el QR', async () => {
      const { body } = await con('get', `/api/ventas/${venta.v1}`, dora.acceso).expect(200);
      const v1 = body.venta as VentaDetalle;
      expect(v1.numero).toBe('DEA-00000001');
      expect(v1.ticket.qr).toBe('DEA-00000001');
      expect(v1.cambio).toBeNull();
      const pdf = await con('post', `/api/ventas/${venta.v1}/imprimir`, dora.acceso)
        .buffer(true)
        .parse(comoBytes)
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('con el turno todavía abierto la venta se anula: no se puede devolver', async () => {
      const v1 = await buscarVenta(dora.acceso, 'DEA-00000001');
      expect(v1.motivo_no).toBe(
        'La venta DEA-00000001 es de un turno que sigue abierto: se anula, no se devuelve',
      );
      await solicitar(dora.acceso, {
        venta_id: venta.v1,
        tipo: 'DEVOLUCION',
        motivo: 'No le gustó el aroma',
        lineas: [{ detalle_id: linea.v1Perfume, cantidad: 1, estado: 'BUENO' }],
      })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: v1.motivo_no });
      await comoJefa('post', `/api/turnos/${ids.turnoA}/cierre-forzado`)
        .send({ motivo: 'Cierre del día de ventas de la prueba de devoluciones' })
        .expect(200);
    });

    it('GET /api/devoluciones/venta?numero= la encuentra desde cualquier sucursal, con lo que se puede devolver', async () => {
      // Beto es de la otra sucursal: una venta de la A normalmente no la ve
      await con('get', `/api/ventas/${venta.v1}`, beto.acceso).expect(404);
      const v1 = await buscarVenta(beto.acceso, 'dea-1'); // escrito a mano, sin los ceros
      expect(v1).toEqual({
        id: venta.v1,
        numero: 'DEA-00000001',
        fecha: expect.any(String),
        estado: 'COMPLETADA',
        sucursal: { id: ids.a, codigo: 'DEA', nombre: SUC_A },
        vendedor: 'Dora Devoluciones',
        cliente_nombre: null,
        cliente_telefono: null,
        total: '900.00',
        motivo_no: null,
        limite: sumarDias(hoy, 7),
        lineas: [
          {
            detalle_id: linea.v1Cadena,
            variante: { id: pieza.cadena, sku: 'DVE-CAD', nombre: 'Regalo DVE — Cadena' },
            categoria: 'Regalos DVE',
            cantidad: 1,
            devuelta: 0,
            apartada: 0,
            disponible: 1,
            monto_unitario: '540.00', // C$600 menos su parte de la promoción
            admite: true,
            motivo_no: null,
          },
          {
            detalle_id: linea.v1Perfume,
            variante: { id: pieza.perfume, sku: 'DVE-PERF', nombre: 'Regalo DVE — Perfume' },
            categoria: 'Regalos DVE',
            cantidad: 1,
            devuelta: 0,
            apartada: 0,
            disponible: 1,
            monto_unitario: '360.00',
            admite: true,
            motivo_no: null,
          },
        ],
        solicitudes: [],
      });
      // sin costos: la vendedora ve lo que se pagó, nada más
      expect(JSON.stringify(v1)).not.toMatch(/costo|margen/);
    });

    it('las piezas de piercing no se devuelven; factura inexistente → 404; número inválido → 400', async () => {
      const v3 = await buscarVenta(dora.acceso, 'DEA-00000003');
      expect(v3.lineas).toEqual([
        expect.objectContaining({
          detalle_id: linea.v3Aro,
          admite: false,
          motivo_no: 'La categoría "Piezas DVE" no admite devoluciones',
        }),
      ]);
      await con('get', '/api/devoluciones/venta?numero=DEA-999', dora.acceso)
        .expect(404)
        .expect({ codigo: 'NO_ENCONTRADO', mensaje: 'La factura DEA-00000999 no existe' });
      const invalida = await con('get', '/api/devoluciones/venta?numero=999', dora.acceso).expect(
        400,
      );
      expect(invalida.body.errores).toEqual([
        { campo: 'numero', mensaje: 'El número de factura no es válido (ejemplo: LAM-00000012)' },
      ]);
    });
  });

  describe('1) la solicitud', () => {
    it('datos inválidos → 400 con el campo; lo que no se puede devolver → 422 con el motivo', async () => {
      const invalida = await solicitar(dora.acceso, {
        venta_id: venta.v1,
        tipo: 'REGALO',
        motivo: 'no',
        cliente_nombre: '',
        cliente_telefono: '123',
        lineas: [{ detalle_id: linea.v1Perfume, cantidad: 0, estado: 'USADO' }],
      }).expect(400);
      expect(invalida.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'tipo',
        'motivo',
        'cliente_nombre',
        'cliente_telefono',
        'lineas.0.cantidad',
        'lineas.0.estado',
      ]);
      const base = { tipo: 'DEVOLUCION', motivo: 'No le gustó lo que compró' };
      const rechazos: [Record<string, unknown>, string][] = [
        [
          {
            venta_id: venta.v3,
            lineas: [{ detalle_id: linea.v3Aro, cantidad: 1, estado: 'BUENO' }],
          },
          '"Piercing DVE — Aro" no se puede devolver: la categoría "Piezas DVE" no admite devoluciones',
        ],
        [
          {
            venta_id: venta.v1,
            lineas: [{ detalle_id: linea.v1Perfume, cantidad: 2, estado: 'BUENO' }],
          },
          'De "Regalo DVE — Perfume" solo queda(n) 1 por devolver (vendidas: 1, ya devueltas: 0, en otras solicitudes: 0)',
        ],
        [
          {
            venta_id: venta.v1,
            lineas: [{ detalle_id: linea.v2Perfume, cantidad: 1, estado: 'BUENO' }],
          },
          `La línea ${linea.v2Perfume} no es de la venta DEA-00000001`,
        ],
        [
          { venta_id: 999999, lineas: [{ detalle_id: 1, cantidad: 1, estado: 'BUENO' }] },
          'La venta 999999 no existe',
        ],
      ];
      for (const [cuerpo, mensaje] of rechazos) {
        await solicitar(dora.acceso, { ...base, ...cuerpo })
          .expect(422)
          .expect({ codigo: 'REGLA_NEGOCIO', mensaje });
      }
    });

    it('POST /api/devoluciones: queda pendiente, con lo pagado por lo devuelto, y avisa al administrador', async () => {
      const { body } = await solicitar(dora.acceso, {
        venta_id: venta.v1,
        tipo: 'devolucion',
        motivo: ' No le gustó el aroma ',
        lineas: [{ detalle_id: linea.v1Perfume, cantidad: 1, estado: 'bueno' }],
        // nada de esto lo decide la pantalla
        monto_total: 5000,
        estado: 'APROBADA',
        sucursal_id: ids.b,
      }).expect(201);
      const s1 = body.devolucion as DevolucionDetalle;
      dev.s1 = s1.id;
      expect(s1).toEqual({
        id: expect.any(Number),
        numero: null,
        tipo: 'DEVOLUCION',
        estado: 'PENDIENTE',
        venta: {
          id: venta.v1,
          numero: 'DEA-00000001',
          fecha: expect.any(String),
          sucursal: { id: ids.a, codigo: 'DEA', nombre: SUC_A },
        },
        motivo: 'No le gustó el aroma',
        cliente_nombre: 'Carla Cliente',
        cliente_telefono: '8888-1234',
        monto_total: '360.00',
        sucursal_solicitud: { id: ids.a, codigo: 'DEA', nombre: SUC_A }, // la del equipo de Dora
        solicitada_por: { id: ids.dora, nombre_completo: 'Dora Devoluciones' },
        solicitada_at: expect.any(String),
        vence_el: null,
        sucursal: null,
        ejecutada_at: null,
        por_transferir: false,
        lineas: [
          {
            id: expect.any(Number),
            detalle_id: linea.v1Perfume,
            variante: { id: pieza.perfume, sku: 'DVE-PERF', nombre: 'Regalo DVE — Perfume' },
            cantidad: 1,
            estado_producto: 'BUENO',
            monto: '360.00',
          },
        ],
        resolucion: null,
        cancelacion: null,
        // lo previsto: la venta se pagó en efectivo, así que todo sale de la caja
        reembolso: { saldo: '0.00', efectivo: '360.00', transferencia: '0.00', definitivo: false },
        ejecucion: null,
        venta_cambio: null,
        transferencia: null,
        ticket: { negocio: 'Esmeralda Experience', ruc: null, direccion: null, telefono: null },
      });
      expect(await alertas('DEVOLUCION_PENDIENTE')).toEqual([
        expect.objectContaining({
          titulo: 'Devolución por aprobar: factura DEA-00000001, C$ 360.00',
          detalle: expect.objectContaining({ devolucion_id: dev.s1, venta_id: venta.v1 }),
          sucursal: { id: ids.a, codigo: 'DEA', nombre: SUC_A },
        }),
      ]);
    });

    it('lo pedido queda apartado: no se puede pedir dos veces', async () => {
      const v1 = await buscarVenta(elsa.acceso, 'DEA-00000001');
      expect(v1.lineas[1]).toMatchObject({
        apartada: 1,
        disponible: 0,
        motivo_no: 'Ya se devolvió o está en otra solicitud',
      });
      expect(v1.solicitudes).toEqual([
        expect.objectContaining({ id: dev.s1, estado: 'PENDIENTE', monto_total: '360.00' }),
      ]);
      const { body } = await solicitar(elsa.acceso, {
        venta_id: venta.v1,
        tipo: 'CAMBIO',
        motivo: 'Ahora quiere cambiarlo',
        lineas: [{ detalle_id: linea.v1Perfume, cantidad: 1, estado: 'BUENO' }],
      }).expect(422);
      expect(body.mensaje).toMatch(/solo queda\(n\) 0 por devolver/);
    });

    it('la ven su sucursal y el administrador; la otra sucursal, no (todavía)', async () => {
      for (const acceso of [dora.acceso, elsa.acceso, jefa.acceso]) {
        expect((await ver(acceso, dev.s1)).estado).toBe('PENDIENTE');
        const { body } = await con('get', '/api/devoluciones?estado=pendiente', acceso).expect(200);
        expect((body.devoluciones as DevolucionResumen[]).map((d) => d.id)).toContain(dev.s1);
      }
      await con('get', `/api/devoluciones/${dev.s1}`, beto.acceso)
        .expect(404)
        .expect({ codigo: 'NO_ENCONTRADO', mensaje: `La devolución ${dev.s1} no existe` });
      const { body } = await con('get', '/api/devoluciones', beto.acceso).expect(200);
      expect(body.devoluciones).toEqual([]);
      await con('get', '/api/devoluciones/999999', jefa.acceso).expect(404);
    });
  });

  describe('2) solo el administrador aprueba o rechaza', () => {
    it('rechazar pide el motivo; aprobar deja 3 días para ejecutarla', async () => {
      const ruta = `/api/devoluciones/${dev.s1}/resolver`;
      await con('post', ruta, dora.acceso).send({ aprobar: true }).expect(403);
      const sinMotivo = await comoJefa('post', ruta).send({ aprobar: false }).expect(400);
      expect(sinMotivo.body.errores).toEqual([
        {
          campo: 'comentario',
          mensaje: 'Para rechazar la devolución escriba el motivo (al menos 5 caracteres)',
        },
      ]);
      // sin una caja abierta no se ejecuta nada
      await con('post', `/api/devoluciones/${dev.s1}/ejecutar`, dora.acceso)
        .send({})
        .expect(409)
        .expect({
          codigo: 'SIN_TURNO_ABIERTO',
          mensaje: 'La caja no tiene un turno abierto: ábrala primero',
        });

      const { body } = await comoJefa('post', ruta)
        .send({ aprobar: true, comentario: ' Proceda ' })
        .expect(200);
      expect(body.devolucion).toMatchObject({
        estado: 'APROBADA',
        vence_el: sumarDias(hoy, 3),
        resolucion: {
          fecha: expect.any(String),
          resuelta_por: { id: ids.jefa, nombre_completo: 'Jefa de devoluciones' },
          comentario: 'Proceda',
        },
      });
      expect(await alertas('DEVOLUCION_PENDIENTE')).toEqual([]);
      await comoJefa('post', ruta)
        .send({ aprobar: false, comentario: 'Mejor no' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La solicitud de devolución ${dev.s1} ya fue aprobada`,
        });
    });
  });

  describe('3) se ejecuta en la caja abierta de la sucursal donde está el cliente', () => {
    it('aprobada, la puede ver y ejecutar otra sucursal', async () => {
      expect((await ver(beto.acceso, dev.s1)).estado).toBe('APROBADA');
      const ruta = `/api/devoluciones/${dev.s1}/ejecutar`;
      await con('post', ruta, beto.acceso).send({}).expect(409); // la caja de la B está cerrada
      const turno = await con('post', '/api/caja/turno/abrir', beto.acceso)
        .send({ inicial_nio: 1000 })
        .expect(201);
      ids.turnoB = turno.body.turno.id;

      const { body } = await con('post', ruta, beto.acceso).expect(200); // sin cuerpo
      expect(body.repetida).toBe(false);
      expect(body.devolucion).toMatchObject({
        numero: 'DEV-DEB-000001', // su número propio, de la sucursal donde se ejecuta
        estado: 'EJECUTADA',
        sucursal: { id: ids.b, codigo: 'DEB', nombre: SUC_B },
        ejecutada_at: expect.any(String),
        por_transferir: false,
        reembolso: { saldo: '0.00', efectivo: '360.00', transferencia: '0.00', definitivo: true },
        ejecucion: {
          fecha: expect.any(String),
          ejecutada_por: { id: ids.beto, nombre_completo: 'Beto Devoluciones' },
          turno_id: ids.turnoB,
          caja: { id: ids.cajaB, nombre: 'Caja 1' },
        },
        venta_cambio: null,
        ticket: { direccion: 'Plaza DEB', telefono: '2222-0000' },
      });
      await con('post', ruta, beto.acceso)
        .send({})
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La devolución ${dev.s1} ya se ejecutó (DEV-DEB-000001)`,
        });
    });

    it('el efectivo sale de ese turno y cuenta en el arqueo; la vendedora no ve totales', async () => {
      expect(await esperadoEnCaja(ids.turnoB)).toBe('640.00'); // 1000 − 360
      const { body } = await con('get', '/api/caja/turno', beto.acceso).expect(200);
      expect(JSON.stringify(body)).not.toMatch(/esperad|640|360|monto/);
      await con('get', `/api/turnos/${ids.turnoB}`, beto.acceso).expect(403);
    });

    it('lo devuelto entra al stock de esa sucursal y queda en el kardex; la factura no cambia', async () => {
      expect(await stock(ids.b, pieza.perfume)).toBe(1);
      expect(await stock(ids.a, pieza.perfume)).toBe(6); // 10 − 4 vendidos: en la A no se movió
      const { body } = await comoJefa(
        'get',
        `/api/inventario/movimientos?sucursal_id=${ids.b}&tipo=DEVOLUCION`,
      ).expect(200);
      expect(body.movimientos as Movimiento[]).toEqual([
        expect.objectContaining({
          tipo: 'DEVOLUCION',
          cantidad: 1,
          stock_resultante: 1,
          costo_unitario: '150.00',
          motivo: 'Devolución DEV-DEB-000001 de la factura DEA-00000001',
          variante: { id: pieza.perfume, sku: 'DVE-PERF', nombre: 'Regalo DVE — Perfume' },
          usuario: { id: ids.beto, nombre_completo: 'Beto Devoluciones' },
          venta_id: null,
          devolucion_id: dev.s1,
        }),
      ]);
      const factura = (await comoJefa('get', `/api/ventas/${venta.v1}`).expect(200)).body
        .venta as VentaDetalle;
      expect(factura).toMatchObject({
        estado: 'COMPLETADA',
        subtotal: '1000.00',
        descuento: '100.00',
        total: '900.00',
      });
      expect(factura.lineas).toHaveLength(2);
      const v1 = await buscarVenta(dora.acceso, 'DEA-00000001');
      expect(v1.lineas[1]).toMatchObject({ devuelta: 1, apartada: 0, disponible: 0 });
    });

    it('POST /api/devoluciones/:id/imprimir: ticket de 80 mm; la reimpresión es COPIA', async () => {
      const imprimir = (acceso: string, id: number) =>
        con('post', `/api/devoluciones/${id}/imprimir`, acceso).buffer(true).parse(comoBytes);
      const original = await imprimir(beto.acceso, dev.s1).expect(200);
      expect(original.headers['content-type']).toBe('application/pdf');
      expect(original.headers['content-disposition']).toBe(
        'inline; filename="devolucion-DEV-DEB-000001.pdf"',
      );
      expect(original.headers['x-ticket-impresion']).toBe('1');
      const pdf = (original.body as Buffer).toString('latin1');
      expect(pdf.startsWith('%PDF-')).toBe(true);
      expect(pdf).toMatch(/\/MediaBox \[0 0 226\.77\d* [\d.]+\]/);
      // la imprime también la sucursal que la solicitó, y ya es copia
      const copia = await imprimir(dora.acceso, dev.s1).expect(200);
      expect(copia.headers['x-ticket-impresion']).toBe('2');
      await con('post', `/api/devoluciones/${dev.s1}/imprimir`, nora.acceso).expect(403);
    });
  });

  describe('reembolso según cómo se pagó', () => {
    it('pago mixto: una parte en efectivo desde la caja y el resto por transferencia del administrador', async () => {
      const { body } = await solicitar(dora.acceso, {
        venta_id: venta.v2,
        tipo: 'DEVOLUCION',
        motivo: 'Uno venía con el atomizador roto',
        cliente_nombre: 'Luis Cliente',
        cliente_telefono: '7777-0000',
        lineas: [
          { detalle_id: linea.v2Perfume, cantidad: 1, estado: 'DEFECTUOSO' },
          { detalle_id: linea.v2Perfume, cantidad: 1, estado: 'BUENO' },
        ],
      }).expect(201);
      const s2 = body.devolucion as DevolucionDetalle;
      dev.s2 = s2.id;
      expect(s2.monto_total).toBe('800.00');
      expect(s2.lineas.map((l) => [l.estado_producto, l.cantidad, l.monto])).toEqual([
        ['BUENO', 1, '400.00'],
        ['DEFECTUOSO', 1, '400.00'],
      ]);
      // la venta se pagó 1/3 en efectivo y 2/3 con tarjeta: así se reparte lo que se devuelve
      expect(s2.reembolso).toEqual({
        saldo: '0.00',
        efectivo: '266.67',
        transferencia: '533.33',
        definitivo: false,
      });
      await aprobar(dev.s2);

      const turno = await con('post', '/api/caja/turno/abrir', dora.acceso)
        .send({ inicial_nio: 2000 })
        .expect(201);
      ids.turnoA2 = turno.body.turno.id;
      const ejecutada = await con('post', `/api/devoluciones/${dev.s2}/ejecutar`, dora.acceso)
        .send({})
        .expect(200);
      expect(ejecutada.body.devolucion).toMatchObject({
        numero: 'DEV-DEA-000001',
        estado: 'EJECUTADA',
        por_transferir: true,
        reembolso: { saldo: '0.00', efectivo: '266.67', transferencia: '533.33', definitivo: true },
        transferencia: null,
      });
      // de la caja solo sale el efectivo
      expect(await esperadoEnCaja(ids.turnoA2)).toBe('1733.33');
    });

    it('lo defectuoso entra como merma ya aprobada', async () => {
      expect(await stock(ids.a, pieza.perfume)).toBe(7); // 6 + 2 devueltos − 1 defectuoso
      const { body } = await comoJefa(
        'get',
        `/api/mermas?estado=APROBADA&sucursal_id=${ids.a}`,
      ).expect(200);
      expect(body.mermas as Merma[]).toEqual([
        expect.objectContaining({
          variante: { id: pieza.perfume, sku: 'DVE-PERF', nombre: 'Regalo DVE — Perfume' },
          cantidad: 1,
          motivo: 'Devuelto defectuoso (DEV-DEA-000001): Uno venía con el atomizador roto',
          estado: 'APROBADA',
          reportada_por: { id: ids.dora, nombre_completo: 'Dora Devoluciones' },
          resuelta_por: { id: ids.jefa, nombre_completo: 'Jefa de devoluciones' },
          comentario: 'Aprobada con la devolución DEV-DEA-000001',
        }),
      ]);
      const kardex = await comoJefa(
        'get',
        `/api/inventario/movimientos?sucursal_id=${ids.a}&variante_id=${pieza.perfume}&limite=3`,
      ).expect(200);
      // los tres últimos movimientos del perfume: entran los dos y el defectuoso sale
      const ultimos = (kardex.body.movimientos as Movimiento[]).map(
        (m) => `${m.tipo} ${m.cantidad}`,
      );
      expect(ultimos.sort((a, b) => a.localeCompare(b))).toEqual([
        'DEVOLUCION 1',
        'DEVOLUCION 1',
        'MERMA -1',
      ]);
    });

    it('el administrador anota la transferencia con su referencia; no pasa por la caja', async () => {
      expect(await alertas('DEVOLUCION_TRANSFERENCIA')).toEqual([
        expect.objectContaining({
          titulo: 'Devolución DEV-DEA-000001: falta transferirle al cliente C$ 533.33',
          detalle: expect.objectContaining({ devolucion_id: dev.s2, monto: 533.33 }),
        }),
      ]);
      const porTransferir = await comoJefa('get', '/api/devoluciones?por_transferir=true').expect(
        200,
      );
      expect((porTransferir.body.devoluciones as DevolucionResumen[]).map((d) => d.id)).toEqual([
        dev.s2,
      ]);
      const ruta = `/api/devoluciones/${dev.s2}/transferencia`;
      await con('post', ruta, dora.acceso).send({ referencia: 'BAC-778899' }).expect(403);
      const corta = await comoJefa('post', ruta).send({ referencia: ' x ' }).expect(400);
      expect(corta.body.errores).toEqual([
        { campo: 'referencia', mensaje: 'La referencia debe tener al menos 3 caracteres' },
      ]);
      const { body } = await comoJefa('post', ruta)
        .send({ referencia: ' BAC-778899 ' })
        .expect(200);
      expect(body.devolucion).toMatchObject({
        por_transferir: false,
        transferencia: {
          referencia: 'BAC-778899',
          fecha: expect.any(String),
          transferida_por: { id: ids.jefa, nombre_completo: 'Jefa de devoluciones' },
        },
      });
      expect(await alertas('DEVOLUCION_TRANSFERENCIA')).toEqual([]);
      expect(await esperadoEnCaja(ids.turnoA2)).toBe('1733.33');
      await comoJefa('post', ruta).send({ referencia: 'BAC-000' }).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'La transferencia de la devolución DEV-DEA-000001 ya está anotada (BAC-778899)',
      });
      // la que se pagó toda en efectivo no tiene nada que transferir
      await comoJefa('post', `/api/devoluciones/${dev.s1}/transferencia`)
        .send({ referencia: 'BAC-111' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La devolución DEV-DEB-000001 no tiene nada que transferir',
        });
    });
  });

  describe('cancelar y vencer', () => {
    const tercerPerfume = () => ({
      venta_id: venta.v2,
      tipo: 'DEVOLUCION',
      motivo: 'El tercer perfume tampoco le gustó',
      lineas: [{ detalle_id: linea.v2Perfume, cantidad: 1, estado: 'BUENO' }],
    });

    it('la cancela quien la solicitó (o el administrador) y libera lo apartado', async () => {
      const { body } = await solicitar(dora.acceso, tercerPerfume()).expect(201);
      dev.s3 = body.devolucion.id;
      expect(body.devolucion.monto_total).toBe('400.00');
      const ruta = `/api/devoluciones/${dev.s3}/cancelar`;
      await con('post', ruta, beto.acceso).send({ motivo: 'No era mía' }).expect(404);
      await con('post', ruta, elsa.acceso).send({ motivo: 'La cancelo yo' }).expect(403).expect({
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Solo quien hizo la solicitud o el administrador pueden cancelarla',
      });
      const corto = await con('post', ruta, dora.acceso).send({ motivo: 'no' }).expect(400);
      expect(corto.body.errores[0].campo).toBe('motivo');
      const cancelada = await con('post', ruta, dora.acceso)
        .send({ motivo: 'El cliente se lo quedó' })
        .expect(200);
      expect(cancelada.body.devolucion).toMatchObject({
        estado: 'CANCELADA',
        cancelacion: {
          fecha: expect.any(String),
          motivo: 'El cliente se lo quedó',
          cancelada_por: { id: ids.dora, nombre_completo: 'Dora Devoluciones' },
        },
        reembolso: null,
      });
      const v2 = await buscarVenta(dora.acceso, 'DEA-00000002');
      expect(v2.lineas[0]).toMatchObject({ devuelta: 2, apartada: 0, disponible: 1 });
      await comoJefa('post', `/api/devoluciones/${dev.s3}/resolver`)
        .send({ aprobar: true })
        .expect(422);
    });

    it('una aprobada que no se ejecuta en su plazo la cancela sola la tarea programada', async () => {
      const { body } = await solicitar(dora.acceso, tercerPerfume()).expect(201);
      dev.s4 = body.devolucion.id;
      await aprobar(dev.s4);
      const tareas = app.get(TareasService);
      // dentro del plazo no pasa nada
      expect((await tareas.ejecutar()).devoluciones_vencidas).toBe(0);
      expect((await ver(dora.acceso, dev.s4)).estado).toBe('APROBADA');

      // Como si se hubiera aprobado hace cuatro días: su último día fue ayer
      await sql`update devolucion set vence_el = ${sumarDias(hoy, -1)}::date where id = ${dev.s4}`.execute(
        bd.db,
      );
      await con('post', `/api/devoluciones/${dev.s4}/ejecutar`, dora.acceso)
        .send({})
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La solicitud de devolución ${dev.s4} venció el ${sumarDias(hoy, -1).split('-').reverse().join('/')}: hay que hacer una nueva`,
        });
      expect((await tareas.ejecutar()).devoluciones_vencidas).toBe(1);
      expect((await tareas.ejecutar()).devoluciones_vencidas).toBe(0);
      const vencida = await ver(jefa.acceso, dev.s4);
      expect(vencida).toMatchObject({
        estado: 'CANCELADA',
        cancelacion: { cancelada_por: null }, // venció sola
      });
      expect(vencida.cancelacion?.motivo).toMatch(/^Venció: estaba aprobada y no se ejecutó/);
      const v2 = await buscarVenta(dora.acceso, 'DEA-00000002');
      expect(v2.lineas[0]).toMatchObject({ apartada: 0, disponible: 1 });
      expect(v2.solicitudes.map((s) => [s.id, s.estado])).toEqual([
        [dev.s4, 'CANCELADA'],
        [dev.s3, 'CANCELADA'],
        [dev.s2, 'EJECUTADA'],
      ]);
    });

    it('la que vence deja dos alertas: una en el panel y otra para la sucursal que la solicitó', async () => {
      const titulo = `Venció la devolución aprobada de la factura DEA-00000002: no se ejecutó hasta el ${sumarDias(hoy, -1).split('-').reverse().join('/')}`;
      const delPanel = await alertas('DEVOLUCION_VENCIDA');
      expect(delPanel).toEqual([
        expect.objectContaining({
          titulo,
          detalle: {
            devolucion_id: dev.s4,
            venta_id: venta.v2,
            numero: 'DEA-00000002',
            tipo: 'DEVOLUCION',
            vence_el: sumarDias(hoy, -1),
            solicitada_por: ids.dora,
          },
          sucursal: { id: ids.a, codigo: 'DEA', nombre: SUC_A },
          atendida_at: null,
        }),
      ]);

      // Quienes trabajan en la sucursal que la solicitó ven la suya sin entrar al panel
      const deDora = await alertasDeSucursal(dora.acceso);
      expect(deDora).toEqual({
        alertas: [{ ...delPanel[0], id: expect.any(Number) }],
        total_pendientes: 1,
      });
      const [aviso] = deDora.alertas;
      expect(aviso.id).not.toBe(delPanel[0].id);
      expect(await alertasDeSucursal(elsa.acceso)).toEqual(deDora);
      expect(await alertasDeSucursal(beto.acceso)).toEqual({ alertas: [], total_pendientes: 0 });
      await con('get', '/api/alertas', dora.acceso).expect(403);

      // Cada quien atiende la suya: ni la de otra sucursal ni la del panel
      const sinPermiso = {
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere ALERTAS_VER',
      };
      await con('post', `/api/alertas/${aviso.id}/atender`, beto.acceso)
        .expect(403)
        .expect(sinPermiso);
      await con('post', `/api/alertas/${delPanel[0].id}/atender`, dora.acceso)
        .expect(403)
        .expect(sinPermiso);
      const atendida = await con('post', `/api/alertas/${aviso.id}/atender`, dora.acceso).expect(
        200,
      );
      expect(atendida.body.alerta).toMatchObject({
        id: aviso.id,
        atendida_at: expect.any(String),
        atendida_por: { id: ids.dora, nombre_completo: 'Dora Devoluciones' },
      });
      expect(await alertasDeSucursal(elsa.acceso)).toEqual({ alertas: [], total_pendientes: 0 });
      const yaAtendidas = await alertasDeSucursal(dora.acceso, '?estado=atendidas');
      expect(yaAtendidas.alertas.map((a) => a.id)).toEqual([aviso.id]);

      // La del administrador sigue pendiente hasta que él la atiende
      expect((await alertas('DEVOLUCION_VENCIDA')).map((a) => a.id)).toEqual([delPanel[0].id]);
      await comoJefa('post', `/api/alertas/${delPanel[0].id}/atender`).expect(200);
      expect(await alertas('DEVOLUCION_VENCIDA')).toEqual([]);
    });

    it('rechazada con su comentario: no aparta nada ni se ejecuta', async () => {
      const { body } = await solicitar(dora.acceso, tercerPerfume()).expect(201);
      const id = body.devolucion.id as number;
      const rechazada = await comoJefa('post', `/api/devoluciones/${id}/resolver`)
        .send({ aprobar: false, comentario: 'El perfume viene usado' })
        .expect(200);
      expect(rechazada.body.devolucion).toMatchObject({
        estado: 'RECHAZADA',
        vence_el: null,
        resolucion: { comentario: 'El perfume viene usado' },
      });
      await con('post', `/api/devoluciones/${id}/ejecutar`, dora.acceso)
        .send({})
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La solicitud de devolución ${id} está rechazada: solo se ejecuta una aprobada`,
        });
    });
  });

  describe('cambio: una venta nueva pagada con lo devuelto', () => {
    it('si lo nuevo cuesta más, el cliente paga la diferencia', async () => {
      const { body } = await solicitar(dora.acceso, {
        venta_id: venta.v4,
        tipo: 'CAMBIO',
        motivo: 'Prefiere dos perfumes',
        cliente_nombre: 'Marta Cliente',
        cliente_telefono: '8765-4321',
        lineas: [{ detalle_id: linea.v4Cadena, cantidad: 1, estado: 'BUENO' }],
      }).expect(201);
      dev.s5 = body.devolucion.id;
      // en un cambio, cómo se entrega depende de lo que se lleve: todavía no se sabe
      expect(body.devolucion).toMatchObject({
        tipo: 'CAMBIO',
        monto_total: '600.00',
        reembolso: null,
      });
      await aprobar(dev.s5);

      const ruta = `/api/devoluciones/${dev.s5}/ejecutar`;
      await con('post', ruta, dora.acceso).send({}).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'Para ejecutar un cambio indique lo que se lleva el cliente',
      });
      const items = [{ variante_id: pieza.perfume, cantidad: 2 }];
      await con('post', ruta, dora.acceso)
        .send({ items, pagos: [{ metodo: 'EFECTIVO', monto: 300 }] })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La venta de un cambio necesita su clave de idempotencia',
        });
      await con('post', ruta, dora.acceso)
        .send({
          clave_idempotencia: randomUUID(),
          items,
          pagos: [{ metodo: 'EFECTIVO', monto: 100 }],
        })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Pago insuficiente: total C$ 800.00, pagado C$ 700.00',
        });
      // un cambio que falla no deja nada a medias
      expect((await ver(dora.acceso, dev.s5)).estado).toBe('APROBADA');
      expect(await stock(ids.a, pieza.cadena)).toBe(7);

      const ejecutado = await con('post', ruta, dora.acceso)
        .send({
          clave_idempotencia: cambio.clave,
          items,
          pagos: [{ metodo: 'EFECTIVO', monto: 300 }],
          notas: 'Cambio de cadena por perfumes',
          promocion_id: ids.promocion, // un cambio no lleva promoción: se descarta
        })
        .expect(200);
      expect(ejecutado.body.repetida).toBe(false);
      const s5 = ejecutado.body.devolucion as DevolucionDetalle;
      expect(s5).toMatchObject({
        numero: 'DEV-DEA-000002', // el intento fallido no consumió número
        estado: 'EJECUTADA',
        por_transferir: false,
        reembolso: { saldo: '600.00', efectivo: '0.00', transferencia: '0.00', definitivo: true },
        venta_cambio: { id: expect.any(Number), numero: 'DEA-00000006', total: '800.00' },
      });
      cambio.venta = s5.venta_cambio?.id ?? 0;
      expect(await stock(ids.a, pieza.cadena)).toBe(8); // volvió la cadena
      expect(await stock(ids.a, pieza.perfume)).toBe(5); // salieron dos perfumes
    });

    it('la venta nueva lleva lo devuelto como "saldo por cambio" y no se anula', async () => {
      const { body } = await con('get', `/api/ventas/${cambio.venta}`, dora.acceso).expect(200);
      const nueva = body.venta as VentaDetalle;
      expect(nueva).toMatchObject({
        numero: 'DEA-00000006',
        turno_id: ids.turnoA2,
        vendedor: { id: ids.dora },
        cliente_nombre: 'Marta Cliente',
        cliente_telefono: '8765-4321',
        notas: 'Cambio de cadena por perfumes',
        subtotal: '800.00',
        descuento: '0.00',
        total: '800.00',
        promocion: null,
        vuelto: '100.00',
        cambio: { devolucion_id: dev.s5, numero: 'DEV-DEA-000002' },
      });
      expect(nueva.pagos.map((p) => [p.metodo.codigo, p.metodo.nombre, p.monto_nio])).toEqual([
        ['SALDO_CAMBIO', 'Saldo por cambio', '600.00'],
        ['EFECTIVO', 'Efectivo', '300.00'],
      ]);
      await comoJefa('post', `/api/ventas/${cambio.venta}/anular`)
        .send({ motivo: 'Se equivocaron de perfume' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje:
            'La venta DEA-00000006 nació del cambio DEV-DEA-000002: no se anula (lo comprado en ella se puede devolver después)',
        });
      // el saldo no es dinero: a la caja solo entró la diferencia (300 − 100 de vuelto)
      expect(await esperadoEnCaja(ids.turnoA2)).toBe('1933.33');
    });

    it('el saldo por cambio no se elige al cobrar una venta normal', async () => {
      const metodos = await con('get', '/api/metodos-pago', dora.acceso).expect(200);
      expect(
        (metodos.body.metodos_pago as { codigo: string }[]).map((m) => m.codigo),
      ).not.toContain('SALDO_CAMBIO');
      await con('post', '/api/ventas', dora.acceso)
        .send({
          clave_idempotencia: randomUUID(),
          items: [{ variante_id: pieza.perfume, cantidad: 1 }],
          pagos: [{ metodo: 'SALDO_CAMBIO', monto: 400 }],
        })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'Método de pago inválido: SALDO_CAMBIO' });
    });

    it('reintento con la misma clave → 200 repetida, sin ejecutar nada otra vez', async () => {
      const cuerpo = {
        clave_idempotencia: cambio.clave,
        items: [{ variante_id: pieza.perfume, cantidad: 2 }],
        pagos: [{ metodo: 'EFECTIVO', monto: 300 }],
      };
      const { body } = await con('post', `/api/devoluciones/${dev.s5}/ejecutar`, dora.acceso)
        .send(cuerpo)
        .expect(200);
      expect(body.repetida).toBe(true);
      expect(body.devolucion).toMatchObject({ numero: 'DEV-DEA-000002', estado: 'EJECUTADA' });
      expect(await stock(ids.a, pieza.perfume)).toBe(5);
      expect(await esperadoEnCaja(ids.turnoA2)).toBe('1933.33');
      // con otra clave ya no es un reintento: la devolución ya se ejecutó
      await con('post', `/api/devoluciones/${dev.s5}/ejecutar`, dora.acceso)
        .send({ ...cuerpo, clave_idempotencia: randomUUID() })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La devolución ${dev.s5} ya se ejecutó (DEV-DEA-000002)`,
        });
    });

    it('si lo nuevo cuesta menos, lo que sobra se devuelve como se pagó (aquí, en efectivo)', async () => {
      const { body } = await solicitar(dora.acceso, {
        venta_id: venta.v5,
        tipo: 'CAMBIO',
        motivo: 'La quiere cambiar por un perfume',
        lineas: [{ detalle_id: linea.v5Cadena, cantidad: 1, estado: 'BUENO' }],
      }).expect(201);
      dev.s6 = body.devolucion.id;
      await aprobar(dev.s6);
      const ruta = `/api/devoluciones/${dev.s6}/ejecutar`;
      const items = [{ variante_id: pieza.perfume, cantidad: 1 }];
      // la clave de otra venta no sirve
      await con('post', ruta, dora.acceso)
        .send({ clave_idempotencia: cambio.clave, items })
        .expect(409)
        .expect({
          codigo: 'CLAVE_REUTILIZADA',
          mensaje: 'Esa clave ya se usó en otra venta: el POS debe generar una clave nueva',
        });
      const ejecutado = await con('post', ruta, dora.acceso)
        .send({ clave_idempotencia: randomUUID(), items }) // sin pagos: el saldo alcanza
        .expect(200);
      expect(ejecutado.body.devolucion).toMatchObject({
        numero: 'DEV-DEA-000003',
        monto_total: '600.00',
        reembolso: { saldo: '400.00', efectivo: '200.00', transferencia: '0.00', definitivo: true },
        venta_cambio: { numero: 'DEA-00000007', total: '400.00' },
      });
      expect(await esperadoEnCaja(ids.turnoA2)).toBe('1733.33'); // salen los C$200 de diferencia
    });
  });

  describe('cierre de la caja', () => {
    it('quien cierra no ve las devoluciones del turno; quien ve las diferencias, sí', async () => {
      // Dora cuenta lo que hay en la gaveta: 1733 córdobas (faltan 33 centavos, dentro de la tolerancia)
      const cierre = await con('post', '/api/caja/turno/cerrar', dora.acceso)
        .send({ efectivo: [{ moneda: 'NIO', valor: 1, cantidad: 1733 }] })
        .expect(200);
      // su ticket: lo que contó, lo que retiró y el fondo. Nada de lo que salió por devoluciones
      expect(
        Object.keys(cierre.body.ticket as TicketCierre).sort((a, b) => a.localeCompare(b)),
      ).toEqual([
        'abierto_por',
        'apertura',
        'caja',
        'cerrado_por',
        'cierre',
        'cierre_forzado',
        'contado',
        'fondo_siguiente_nio',
        'fondo_siguiente_usd',
        'retiro_nio',
        'retiro_usd',
        'sucursal',
        'turno_id',
      ]);

      const { body } = await comoJefa('get', `/api/turnos/${ids.turnoA2}/ticket`).expect(200);
      expect(body.ticket as TicketCierre).toMatchObject({
        ventas: 2, // las dos ventas de cambio
        total_vendido: '1200.00',
        cobros: [{ metodo: 'Efectivo', moneda: 'NIO', monto: '200.00' }],
        saldo_cambio: '1000.00', // lo vendido = cobrado + saldo por cambio
        devoluciones: 3,
        devuelto_efectivo: '466.67', // 266.67 + 0 + 200
      });
      const { body: turno } = await comoJefa('get', `/api/turnos/${ids.turnoA2}`).expect(200);
      expect((turno.turno as TurnoDetalle).diferencia_nio).toBe('-0.33');
    });
  });

  describe('lista', () => {
    it('GET /api/devoluciones con filtros; cada quien, las de sus sucursales', async () => {
      const idsDe = async (acceso: string, consulta = '') => {
        const { body } = await con('get', `/api/devoluciones?${consulta}`, acceso).expect(200);
        return (body.devoluciones as DevolucionResumen[]).map((d) => d.id);
      };
      const todas = await idsDe(dora.acceso, `sucursal_id=${ids.a}`);
      expect(todas.slice(-5).reverse()).toEqual([
        dev.s1,
        dev.s2,
        dev.s3,
        dev.s4,
        expect.any(Number),
      ]);
      expect(todas).toEqual([...todas].sort((a, b) => b - a)); // de la más reciente a la más antigua
      // Beto solo ve la que se ejecutó en su sucursal
      expect(await idsDe(beto.acceso)).toEqual([dev.s1]);
      expect(await idsDe(jefa.acceso, `sucursal_id=${ids.b}`)).toEqual([dev.s1]);
      expect(await idsDe(dora.acceso, 'estado=ejecutada&tipo=cambio')).toEqual([dev.s6, dev.s5]);
      expect(await idsDe(dora.acceso, 'buscar=DEV-DEA-000001')).toEqual([dev.s2]);
      expect(await idsDe(dora.acceso, 'buscar=marta')).toEqual([dev.s5]);
      expect(await idsDe(dora.acceso, `buscar=DEA-00000005`)).toEqual([dev.s6]);
      expect(await idsDe(dora.acceso, `desde=${sumarDias(hoy, 1)}`)).toEqual([]);
      expect(await idsDe(dora.acceso, `hasta=${hoy}&limite=2`)).toEqual(todas.slice(0, 2));
      expect(await idsDe(dora.acceso, `antes_de=${dev.s2}&sucursal_id=${ids.a}`)).toEqual([dev.s1]);
      expect(await idsDe(jefa.acceso, 'por_transferir=true')).toEqual([]);
      const invalida = await con('get', '/api/devoluciones?estado=LISTA', dora.acceso).expect(400);
      expect(invalida.body.errores[0].campo).toBe('estado');
    });
  });

  // Hasta aquí, en la sucursal A se vendieron C$4750 en 7 facturas (las 5 del día y las 2 de los
  // cambios) y de sus ventas se devolvieron C$2360: S1 360 (ejecutada en la B), S2 800, y las
  // cadenas de los dos cambios, 600 + 600.
  describe('reportes: las ventas van netas de devoluciones', () => {
    async function reporte(acceso: string, ruta: string, sucursal = ids.a): Promise<Reporte> {
      const { body } = await con(
        'get',
        `/api/reportes/${ruta}?sucursal_id=${sucursal}`,
        acceso,
      ).expect(200);
      return body.reporte as Reporte;
    }

    function seccion(r: Reporte, clave: string): Seccion {
      const encontrada = r.secciones.find((s) => s.clave === clave);
      if (!encontrada) throw new Error(`El reporte ${r.clave} no tiene la sección ${clave}`);
      return encontrada;
    }

    const neto = {
      ventas: 7, // devolver no borra la factura
      unidades: 6, // 11 vendidas − 5 devueltas
      descuentos: '60.00', // los C$100 de la promoción menos la parte del perfume devuelto
      devoluciones: '2360.00',
      venta_neta: '2390.00', // 4750 − 2360
      sobreprecio: '0.00',
      ticket_promedio: '341.43',
      costo: '880.00', // lo devuelto también resta su costo: volvió al inventario
      margen: '1510.00',
      margen_pct: '63.2',
    };

    it('ventas del día: lo devuelto resta, el día en que se ejecutó la devolución', async () => {
      const s = seccion(await reporte(jefa.acceso, 'ventas'), 'ventas');
      expect(s.columnas.map((c) => c.clave)).toEqual(['periodo', ...Object.keys(neto)]);
      expect(s.columnas[4]).toEqual({
        clave: 'devoluciones',
        titulo: 'Devoluciones',
        tipo: 'monto',
      });
      expect(s.filas).toEqual([{ periodo: hoy, ...neto }]);
      expect(s.totales).toEqual(neto);
      // ayer no hubo ventas ni devoluciones
      const { body } = await comoJefa(
        'get',
        `/api/reportes/ventas?sucursal_id=${ids.a}&desde=${sumarDias(hoy, -7)}&hasta=${sumarDias(hoy, -1)}`,
      ).expect(200);
      expect(seccion(body.reporte as Reporte, 'ventas').filas).toEqual([]);
    });

    it('la devolución se le resta a quien hizo la venta original y a su sucursal, aunque se ejecute en otra', async () => {
      const vendedores = seccion(await reporte(jefa.acceso, 'ventas-por-vendedor'), 'vendedores');
      expect(vendedores.filas).toEqual([
        { vendedor: 'Dora Devoluciones', ...neto, anuladas: 0, total_anulado: '0.00' },
      ]);
      const sucursales = seccion(await reporte(jefa.acceso, 'ventas-por-sucursal'), 'sucursales');
      expect(sucursales.filas).toEqual([{ sucursal: SUC_A, ...neto }]);
      // en la B se ejecutó la devolución S1, pero la venta era de la A: a la B no le resta nada
      const enB = seccion(await reporte(jefa.acceso, 'ventas-por-sucursal', ids.b), 'sucursales');
      expect(enB.filas).toEqual([]);
      expect(enB.totales).toMatchObject({ ventas: 0, devoluciones: '0.00', venta_neta: '0.00' });
    });

    it('productos más vendidos: en unidades y montos netos', async () => {
      const s = seccion(await reporte(jefa.acceso, 'productos'), 'productos');
      expect(s.filas.map((f) => [f.sku, f.unidades, f.venta_neta, f.margen])).toEqual([
        ['DVE-PERF', 4, '1600.00', '1000.00'], // 7 vendidos − 3 devueltos
        ['DVE-CAD', 1, '540.00', '340.00'], // 3 vendidas − 2 devueltas
        ['DVE-ARO', 1, '250.00', '170.00'],
      ]);
    });

    it('cobros: el dinero que entró y el que salió; el saldo por cambio no es dinero', async () => {
      const enA = seccion(await reporte(jefa.acceso, 'cobros'), 'cobros');
      expect(enA.filas).toEqual([
        { metodo: 'Efectivo', moneda: 'NIO', ventas: 5, monto: '2350.00', monto_nio: '2350.00' },
        { metodo: 'Tarjeta', moneda: 'NIO', ventas: 2, monto: '1400.00', monto_nio: '1400.00' },
        {
          metodo: 'Devoluciones en efectivo',
          moneda: 'NIO',
          ventas: null,
          monto: '-466.67',
          monto_nio: '-466.67',
        },
        {
          metodo: 'Devoluciones por transferencia',
          moneda: 'NIO',
          ventas: null,
          monto: '-533.33',
          monto_nio: '-533.33',
        },
      ]);
      expect(JSON.stringify(enA.filas)).not.toMatch(/Saldo por cambio/);
      expect(enA.totales).toEqual({ ventas: 6, monto_nio: '2750.00' });
      // El efectivo sale de la caja donde se ejecutó: los C$360 de S1 salieron en la B.
      // Entre las dos: 2750 − 360 = 2390, la venta neta.
      const enB = seccion(await reporte(jefa.acceso, 'cobros', ids.b), 'cobros');
      expect(enB.filas).toEqual([
        {
          metodo: 'Devoluciones en efectivo',
          moneda: 'NIO',
          ventas: null,
          monto: '-360.00',
          monto_nio: '-360.00',
        },
      ]);
      expect(enB.totales).toEqual({ ventas: 0, monto_nio: '-360.00' });
    });

    it('GET /api/reportes/devoluciones: cada devolución con su motivo y cómo se entregó', async () => {
      await con('get', '/api/reportes/devoluciones', dora.acceso).expect(403); // la vendedora no ve reportes
      const r = await reporte(jefa.acceso, 'devoluciones');
      expect(r).toMatchObject({
        clave: 'devoluciones',
        titulo: 'Devoluciones y cambios',
        desde: hoy,
        hasta: hoy,
        notas: [],
      });
      expect(seccion(r, 'resumen').filas).toEqual([
        {
          tipo: 'Devolución',
          cantidad: 2,
          monto_total: '1160.00',
          monto_saldo: '0.00',
          monto_efectivo: '626.67',
          monto_transferencia: '533.33',
          por_transferir: '0.00', // ya está anotada
        },
        {
          tipo: 'Cambio',
          cantidad: 2,
          monto_total: '1200.00',
          monto_saldo: '1000.00',
          monto_efectivo: '200.00',
          monto_transferencia: '0.00',
          por_transferir: '0.00',
        },
      ]);
      const total = {
        monto_total: '2360.00',
        monto_saldo: '1000.00',
        monto_efectivo: '826.67',
        monto_transferencia: '533.33',
      };
      expect(seccion(r, 'resumen').totales).toEqual({
        cantidad: 4,
        ...total,
        por_transferir: '0.00',
      });

      const lista = seccion(r, 'devoluciones');
      expect(lista.filas).toHaveLength(4);
      expect(lista.filas[0]).toEqual({
        fecha: expect.any(String),
        numero: 'DEV-DEB-000001',
        tipo: 'Devolución',
        factura: 'DEA-00000001',
        sucursal: SUC_B, // se ejecutó en la otra sucursal
        sucursal_venta: SUC_A,
        vendedor: 'Dora Devoluciones',
        monto_total: '360.00',
        monto_saldo: '0.00',
        monto_efectivo: '360.00',
        monto_transferencia: '0.00',
        referencia: null,
        motivo: 'No le gustó el aroma',
        cliente: 'Carla Cliente',
        telefono: '8888-1234',
      });
      expect(lista.filas.map((f) => [f.numero, f.tipo, f.referencia, f.cliente])).toEqual([
        ['DEV-DEB-000001', 'Devolución', null, 'Carla Cliente'],
        ['DEV-DEA-000001', 'Devolución', 'BAC-778899', 'Luis Cliente'],
        ['DEV-DEA-000002', 'Cambio', null, 'Marta Cliente'],
        ['DEV-DEA-000003', 'Cambio', null, 'Carla Cliente'],
      ]);
      expect(lista.totales).toEqual(total);

      const productos = seccion(r, 'productos');
      expect(productos.filas.map((f) => [f.numero, f.sku, f.cantidad, f.estado, f.monto])).toEqual([
        ['DEV-DEB-000001', 'DVE-PERF', 1, 'Bueno', '360.00'],
        ['DEV-DEA-000001', 'DVE-PERF', 1, 'Bueno', '400.00'],
        ['DEV-DEA-000001', 'DVE-PERF', 1, 'Defectuoso', '400.00'],
        ['DEV-DEA-000002', 'DVE-CAD', 1, 'Bueno', '600.00'],
        ['DEV-DEA-000003', 'DVE-CAD', 1, 'Bueno', '600.00'],
      ]);
      expect(productos.filas[2]).toMatchObject({
        factura: 'DEA-00000002',
        producto: 'Regalo DVE — Perfume',
        categoria: 'Regalos DVE',
        motivo: 'Uno venía con el atomizador roto',
      });
      expect(productos.totales).toEqual({ cantidad: 5, monto: '2360.00' });
      // por sucursal: las de sus ventas y las ejecutadas en ella
      const enB = seccion(await reporte(jefa.acceso, 'devoluciones', ids.b), 'devoluciones');
      expect(enB.filas.map((f) => f.numero)).toEqual(['DEV-DEB-000001']);
    });

    it('el nombre y el teléfono del cliente solo los ve el administrador', async () => {
      const r = await reporte(elsa.acceso, 'devoluciones');
      const lista = seccion(r, 'devoluciones');
      expect(lista.filas).toHaveLength(4);
      expect(lista.columnas.map((c) => c.clave)).not.toEqual(
        expect.arrayContaining(['cliente', 'telefono']),
      );
      expect(lista.filas[0]).toMatchObject({
        numero: 'DEV-DEB-000001',
        motivo: 'No le gustó el aroma',
      });
      expect(JSON.stringify(r)).not.toMatch(
        /Carla|Luis Cliente|Marta|8888-1234|7777-0000|8765-4321/,
      );
      // tampoco en el archivo
      const excel = await con(
        'get',
        `/api/reportes/devoluciones?sucursal_id=${ids.a}&formato=xlsx`,
        elsa.acceso,
      )
        .buffer(true)
        .parse(comoBytes)
        .expect(200);
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load(excel.body as unknown as ExcelJS.Buffer);
      expect(libro.worksheets.map((h) => h.name)).toEqual([
        'Resumen',
        'Devoluciones y cambios',
        'Productos devueltos',
      ]);
      const celdas: string[] = [];
      libro.worksheets[1].eachRow((fila) => fila.eachCell((celda) => celdas.push(celda.text)));
      expect(celdas).toEqual(expect.arrayContaining(['DEV-DEA-000001', 'BAC-778899', 'Motivo']));
      expect(celdas.join('|')).not.toMatch(/Cliente|Teléfono|8888-1234/);
      const pdf = await comoJefa(
        'get',
        `/api/reportes/devoluciones?sucursal_id=${ids.a}&formato=pdf`,
      )
        .buffer(true)
        .parse(comoBytes)
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('lo defectuoso aparece como merma aprobada, al costo con que se vendió', async () => {
      const aprobadas = seccion(await reporte(jefa.acceso, 'mermas'), 'aprobadas');
      expect(aprobadas.filas).toEqual([
        expect.objectContaining({
          sku: 'DVE-PERF',
          cantidad: 1,
          costo_unitario: '150.00',
          valor_costo: '150.00',
          motivo: 'Devuelto defectuoso (DEV-DEA-000001): Uno venía con el atomizador roto',
          reportada_por: 'Dora Devoluciones',
          resuelta_por: 'Jefa de devoluciones',
        }),
      ]);
    });

    it('arqueo ciego: sin CAJA_VER_DIFERENCIAS no entra la devolución de un turno todavía abierto', async () => {
      // Nora ve reportes pero no las diferencias de caja. La caja de la B (donde se ejecutó S1) sigue abierta
      const antes = await reporte(nora.acceso, 'ventas');
      expect(antes.notas).toEqual([
        'No incluye las ventas ni las devoluciones de los turnos de caja que siguen abiertos.',
      ]);
      expect(seccion(antes, 'ventas').totales).toEqual({
        ventas: 7,
        unidades: 7,
        descuentos: '100.00',
        devoluciones: '2000.00', // sin los C$360 de S1
        venta_neta: '2750.00',
        sobreprecio: '0.00',
        ticket_promedio: '392.86',
      });
      const lista = seccion(await reporte(nora.acceso, 'devoluciones'), 'devoluciones');
      expect(lista.filas.map((f) => f.numero)).toEqual([
        'DEV-DEA-000001',
        'DEV-DEA-000002',
        'DEV-DEA-000003',
      ]);

      await comoJefa('post', `/api/turnos/${ids.turnoB}/cierre-forzado`)
        .send({ motivo: 'Cierre de la caja B de la prueba de devoluciones' })
        .expect(200);
      const despues = seccion(await reporte(nora.acceso, 'ventas'), 'ventas').totales;
      expect(despues).toMatchObject({ devoluciones: '2360.00', venta_neta: '2390.00' });
      const completa = seccion(await reporte(nora.acceso, 'devoluciones'), 'devoluciones');
      expect(completa.filas).toHaveLength(4);
    });
  });
});
