import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import type {
  DevolucionDetalle,
  DevolucionResumen,
  RepartoEjecucion,
} from '../src/devoluciones/devoluciones.service';
import type { Merma } from '../src/mermas/mermas.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import type { Renglon } from '../src/exportacion/ticket-pdf';
import type { VentaDetalle } from '../src/ventas/ventas.service';
import { cookiePuesta, crearApp, crearUsuarioDePrueba, tokenDeAcceso } from './utilidades';

// Devoluciones en pantalla (frontend F2b parte 2), en una sucursal propia (DEC): lo que necesita
// la pantalla de ejecutar en caja. Tres ventas en un turno que se cierra, sus solicitudes ya
// aprobadas y su ejecución en otro turno:
//   V1 una cadena (C$600) en efectivo     V2 un perfume (C$400) con tarjeta
//   V3 cadena + perfume (C$1000): C$400 en efectivo y C$600 con tarjeta (40 % en efectivo)
// s1 devuelve la cadena de V1 · s2 el perfume de V2 · s3 cambia la cadena de V3 por un perfume.

type Metodo = 'get' | 'post' | 'put';

describe('Devoluciones en caja (pantalla de ejecutar)', () => {
  let app: NestExpressApplication;
  let http: App;
  const ids = { suc: 0, caja: 0, gala: 0 };
  const pieza = { cadena: 0, perfume: 0 };
  const venta = { v1: 0, v2: 0, v3: 0 };
  const dev = { s1: 0, s2: 0, s3: 0 };
  /** La jefa (admin, sin equipo) y Gala (vendedora) en la PC de caja y en su celular. */
  const jefa = { acceso: '' };
  const gala = { acceso: '', celular: '' };

  function con(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  const comoJefa = (metodo: Metodo, ruta: string) => con(metodo, ruta, jefa.acceso);

  async function ver(id: number): Promise<DevolucionDetalle> {
    const { body } = await con('get', `/api/devoluciones/${id}`, gala.acceso).expect(200);
    return body.devolucion as DevolucionDetalle;
  }

  async function reparto(id: number, consulta = ''): Promise<RepartoEjecucion> {
    const { body } = await con(
      'get',
      `/api/devoluciones/${id}/reparto${consulta}`,
      gala.acceso,
    ).expect(200);
    return body.reparto as RepartoEjecucion;
  }

  const gaveta = (valor: 'SI' | 'NO') =>
    comoJefa('put', '/api/parametros/IMPRESION_ABRIR_GAVETA').send({ valor }).expect(200);

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de la caja de devoluciones',
      username: 'jefa.dec',
      password: 'Devolver#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.dec', 'Devolver#2026');

    const sucursal = await comoJefa('post', '/api/sucursales')
      .send({ codigo: 'DEC', nombre: 'Sucursal Devoluciones en caja e2e' })
      .expect(201);
    ids.suc = sucursal.body.sucursal.id;
    const conCaja = await comoJefa('post', `/api/sucursales/${ids.suc}/cajas`)
      .send({ nombre: 'Caja 1' })
      .expect(201);
    ids.caja = conCaja.body.sucursal.cajas[0].id;
    const equipo = await comoJefa('post', '/api/equipos')
      .send({ nombre: 'PC de caja DEC', tipo: 'CAJA', sucursal_id: ids.suc, caja_id: ids.caja })
      .expect(201);
    const tokenEquipo = cookiePuesta(equipo, 'esmeralda_equipo')?.valor ?? '';
    ids.gala = await crearUsuarioDePrueba(app, {
      nombre: 'Gala Devoluciones',
      username: 'gala.dec',
      password: 'Devolver#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.suc],
    });
    gala.acceso = await tokenDeAcceso(app, 'gala.dec', 'Devolver#2026', tokenEquipo);
    gala.celular = await tokenDeAcceso(app, 'gala.dec', 'Devolver#2026');

    const categoria = await comoJefa('post', '/api/categorias')
      .send({ nombre: 'Regalos DEC' })
      .expect(201);
    await comoJefa('put', `/api/categorias/${categoria.body.categoria.id}/admite-devolucion`)
      .send({ admite_devolucion: true })
      .expect(200);
    const producto = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: categoria.body.categoria.id,
        nombre: 'Regalo DEC',
        variantes: [
          { sku: 'DEC-CAD', nombre: 'Cadena', precio_venta: 600, costo: 200 },
          { sku: 'DEC-PERF', nombre: 'Perfume', precio_venta: 400, costo: 150 },
        ],
      })
      .expect(201);
    const variantes = (producto.body.producto as ProductoCatalogo).variantes;
    pieza.cadena = variantes.find((v) => v.sku === 'DEC-CAD')?.id ?? 0;
    pieza.perfume = variantes.find((v) => v.sku === 'DEC-PERF')?.id ?? 0;
    for (const variante of [pieza.cadena, pieza.perfume]) {
      await comoJefa('post', '/api/inventario/movimientos')
        .send({
          sucursal_id: ids.suc,
          variante_id: variante,
          tipo: 'AJUSTE_POSITIVO',
          cantidad: 10,
          motivo: 'Existencias para las pruebas de devoluciones en caja',
        })
        .expect(201);
    }

    // El día de ventas, que se cierra: la devolución es de ventas de un turno ya cerrado
    const turno = await con('post', '/api/caja/turno/abrir', gala.acceso)
      .send({ inicial_nio: 1000 })
      .expect(201);
    const vender = async (cuerpo: Record<string, unknown>) =>
      (
        await con('post', '/api/ventas', gala.acceso)
          .send({ clave_idempotencia: randomUUID(), ...cuerpo })
          .expect(201)
      ).body.venta as VentaDetalle;
    const v1 = await vender({
      items: [{ variante_id: pieza.cadena, cantidad: 1 }],
      pagos: [{ metodo: 'EFECTIVO', monto: 600 }],
    });
    const v2 = await vender({
      items: [{ variante_id: pieza.perfume, cantidad: 1 }],
      pagos: [{ metodo: 'TARJETA', monto: 400, referencia: 'V-400' }],
    });
    const v3 = await vender({
      items: [
        { variante_id: pieza.cadena, cantidad: 1 },
        { variante_id: pieza.perfume, cantidad: 1 },
      ],
      pagos: [
        { metodo: 'EFECTIVO', monto: 400 },
        { metodo: 'TARJETA', monto: 600, referencia: 'V-600' },
      ],
    });
    Object.assign(venta, { v1: v1.id, v2: v2.id, v3: v3.id });
    await comoJefa('post', `/api/turnos/${turno.body.turno.id}/cierre-forzado`)
      .send({ motivo: 'Cierre para las pruebas de devoluciones en caja' })
      .expect(200);

    const lineaDe = (v: VentaDetalle, variante: number) =>
      v.lineas.find((l) => l.variante.id === variante)?.id ?? 0;
    const solicitar = async (
      ventaId: number,
      tipo: string,
      detalle: number,
      estado = 'BUENO',
    ): Promise<number> => {
      const { body } = await con('post', '/api/devoluciones', gala.acceso)
        .send({
          venta_id: ventaId,
          tipo,
          motivo: 'Pruebas de la pantalla de ejecutar',
          cliente_nombre: 'Lía Cliente',
          cliente_telefono: '8555-1212',
          lineas: [{ detalle_id: detalle, cantidad: 1, estado }],
        })
        .expect(201);
      await comoJefa('post', `/api/devoluciones/${body.devolucion.id}/resolver`)
        .send({ aprobar: true })
        .expect(200);
      return body.devolucion.id as number;
    };
    dev.s1 = await solicitar(v1.id, 'DEVOLUCION', lineaDe(v1, pieza.cadena));
    dev.s2 = await solicitar(v2.id, 'DEVOLUCION', lineaDe(v2, pieza.perfume));
    dev.s3 = await solicitar(v3.id, 'CAMBIO', lineaDe(v3, pieza.cadena));

    // Otro día de caja: ahí se ejecutan
    await con('post', '/api/caja/turno/abrir', gala.acceso).send({ inicial_nio: 1000 }).expect(201);
  });

  afterAll(async () => {
    await gaveta('NO');
    await app.close();
  });

  describe('antes de ejecutar: GET /api/devoluciones/:id/reparto', () => {
    it('devolución: lo pagado en efectivo sale de la caja; lo de tarjeta, por transferencia', async () => {
      expect(await reparto(dev.s1)).toEqual({
        saldo: '0.00',
        por_cobrar: '0.00',
        efectivo: '600.00',
        transferencia: '0.00',
      });
      // en una devolución el total de algo nuevo no cuenta
      expect(await reparto(dev.s2, '?total=999')).toEqual({
        saldo: '0.00',
        por_cobrar: '0.00',
        efectivo: '0.00',
        transferencia: '400.00',
      });
    });

    it('cambio: lo devuelto paga lo nuevo; más caro se cobra la diferencia, más barato se entrega lo que sobra', async () => {
      // lo devuelto (la cadena de V3) vale C$600; V3 se pagó 40 % en efectivo
      expect(await reparto(dev.s3, '?total=400')).toEqual({
        saldo: '400.00',
        por_cobrar: '0.00',
        efectivo: '80.00',
        transferencia: '120.00',
      });
      expect(await reparto(dev.s3, '?total=1000.50')).toEqual({
        saldo: '600.00',
        por_cobrar: '400.50',
        efectivo: '0.00',
        transferencia: '0.00',
      });
      expect(await reparto(dev.s3, '?total=600')).toMatchObject({
        saldo: '600.00',
        por_cobrar: '0.00',
        efectivo: '0.00',
      });
    });

    it('total inválido → 400; ajena o inexistente → 404; desde el celular → 403 EQUIPO_REQUERIDO', async () => {
      const { body } = await con(
        'get',
        `/api/devoluciones/${dev.s3}/reparto?total=-5`,
        gala.acceso,
      ).expect(400);
      expect(body.errores).toEqual([
        {
          campo: 'total',
          mensaje:
            'total debe ser un monto de 0 en adelante (lo que suma lo que se lleva el cliente)',
        },
      ]);
      await con('get', '/api/devoluciones/999999999/reparto', gala.acceso).expect(404);
      const celular = await con('get', `/api/devoluciones/${dev.s1}/reparto`, gala.celular).expect(
        403,
      );
      expect(celular.body.codigo).toBe('EQUIPO_REQUERIDO');
    });
  });

  describe('ejecutar: el estado en que se recibe cada línea', () => {
    it('datos inválidos → 400; una línea de otra devolución → 422', async () => {
      const { body } = await con('post', `/api/devoluciones/${dev.s1}/ejecutar`, gala.acceso)
        .send({ lineas: [{ id: 1, estado: 'ROTO' }] })
        .expect(400);
      expect(body.errores).toEqual([
        { campo: 'lineas.0.estado', mensaje: 'Indique el estado del producto: BUENO o DEFECTUOSO' },
      ]);
      const otra = (await ver(dev.s2)).lineas[0].id;
      await con('post', `/api/devoluciones/${dev.s1}/ejecutar`, gala.acceso)
        .send({ lineas: [{ id: otra, estado: 'BUENO' }] })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `Esa línea no es de la devolución ${dev.s1}`,
        });
      expect((await ver(dev.s1)).estado).toBe('APROBADA');
    });

    it('se pidió en buen estado y llega defectuosa: sale como merma aprobada y lo dice', async () => {
      const antes = await ver(dev.s1);
      expect(antes.lineas[0]).toMatchObject({ estado_producto: 'BUENO', estado_recibido: null });
      const { body } = await con('post', `/api/devoluciones/${dev.s1}/ejecutar`, gala.acceso)
        .send({ lineas: [{ id: antes.lineas[0].id, estado: 'defectuoso' }] })
        .expect(200);
      const hecha = body.devolucion as DevolucionDetalle;
      expect(hecha).toMatchObject({
        estado: 'EJECUTADA',
        numero: 'DEV-DEC-000001',
        monto_transferencia: '0.00',
        reembolso: { saldo: '0.00', efectivo: '600.00', transferencia: '0.00', definitivo: true },
      });
      expect(hecha.lineas[0]).toMatchObject({
        estado_producto: 'BUENO',
        estado_recibido: 'DEFECTUOSO',
      });
      const mermas = await comoJefa('get', `/api/mermas?estado=APROBADA&sucursal_id=${ids.suc}`);
      expect(mermas.body.mermas as Merma[]).toEqual([
        expect.objectContaining({
          cantidad: 1,
          estado: 'APROBADA',
          variante: expect.objectContaining({ id: pieza.cadena }),
          motivo: 'Devuelto defectuoso (DEV-DEC-000001): Pruebas de la pantalla de ejecutar',
          comentario:
            'Aprobada con la devolución DEV-DEC-000001: se pidió en buen estado y se recibió defectuoso',
        }),
      ]);
    });

    it('sin decir nada, se recibe como se pidió', async () => {
      const { body } = await con('post', `/api/devoluciones/${dev.s2}/ejecutar`, gala.acceso)
        .send({})
        .expect(200);
      expect((body.devolucion as DevolucionDetalle).lineas[0]).toMatchObject({
        estado_producto: 'BUENO',
        estado_recibido: 'BUENO',
      });
    });
  });

  describe('el ticket por USB y la gaveta', () => {
    const imprimir = (id: number) =>
      con('post', `/api/devoluciones/${id}/imprimir?formato=renglones`, gala.acceso).expect(200);
    const textos = (renglones: Renglon[]) =>
      renglones.map((r) =>
        r.tipo === 'texto' ? r.texto : r.tipo === 'par' ? `${r.izquierda} | ${r.derecha}` : '',
      );

    it('el original lleva la firma y abre la gaveta si sale efectivo; la copia dice COPIA y no la abre', async () => {
      await gaveta('SI');
      const original = await imprimir(dev.s1);
      expect(original.headers['x-ticket-impresion']).toBe('1');
      expect(original.body).toMatchObject({ impresion: 1, abrir_gaveta: true });
      const texto = textos(original.body.renglones as Renglon[]);
      expect(texto).toContain('DEVOLUCIÓN');
      expect(texto).toContain('    Defectuoso'); // como se recibió, no como se pidió
      expect(texto).toContain('Entregado en efectivo C$ | 600.00');
      expect(texto.at(-1)).toBe('Firma: ______________________________');
      expect(texto).not.toContain('COPIA');

      const copia = await imprimir(dev.s1);
      expect(copia.body).toMatchObject({ impresion: 2, abrir_gaveta: false });
      expect(textos(copia.body.renglones as Renglon[])).toContain('COPIA');
    });

    it('la que se transfiere toda no abre la gaveta, ni siquiera el original', async () => {
      const original = await imprimir(dev.s2);
      expect(original.body).toMatchObject({ impresion: 1, abrir_gaveta: false });
      await gaveta('NO');
    });

    it('formato inválido → 400; en PDF, como antes', async () => {
      const { body } = await con(
        'post',
        `/api/devoluciones/${dev.s1}/imprimir?formato=zpl`,
        gala.acceso,
      ).expect(400);
      expect(body.errores).toEqual([
        { campo: 'formato', mensaje: 'formato debe ser pdf o renglones' },
      ]);
      const pdf = await con('post', `/api/devoluciones/${dev.s1}/imprimir`, gala.acceso).expect(
        200,
      );
      expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
      expect(pdf.headers['x-ticket-impresion']).toBe('3');
    });
  });

  describe('cambio y transferencias', () => {
    it('cambio más barato: se entrega lo que mostró el reparto antes de ejecutar', async () => {
      const previsto = await reparto(dev.s3, '?total=400');
      const { body } = await con('post', `/api/devoluciones/${dev.s3}/ejecutar`, gala.acceso)
        .send({
          clave_idempotencia: randomUUID(),
          items: [{ variante_id: pieza.perfume, cantidad: 1 }],
          pagos: [],
        })
        .expect(200);
      const hecha = body.devolucion as DevolucionDetalle;
      expect(hecha.reembolso).toEqual({
        saldo: previsto.saldo,
        efectivo: previsto.efectivo,
        transferencia: previsto.transferencia,
        definitivo: true,
      });
      expect(hecha.venta_cambio).toMatchObject({ total: '400.00' });
      expect(hecha.monto_transferencia).toBe('120.00');
    });

    it('la lista de por transferir trae el monto de cada una, sin sumas; anotada la referencia, sale', async () => {
      const lista = async () => {
        const { body } = await comoJefa(
          'get',
          `/api/devoluciones?por_transferir=true&sucursal_id=${ids.suc}`,
        ).expect(200);
        return body.devoluciones as DevolucionResumen[];
      };
      const pendientes = await lista();
      expect(
        pendientes.map((d) => [d.id, d.monto_transferencia, d.cliente_nombre, d.venta.numero]),
      ).toEqual([
        [dev.s3, '120.00', 'Lía Cliente', 'DEC-00000003'],
        [dev.s2, '400.00', 'Lía Cliente', 'DEC-00000002'],
      ]);
      expect(pendientes.every((d) => d.por_transferir && d.cliente_telefono === '8555-1212')).toBe(
        true,
      );
      // la lista no suma nada
      expect(Object.keys(pendientes[0])).not.toContain('total');

      await comoJefa('post', `/api/devoluciones/${dev.s2}/transferencia`)
        .send({ referencia: 'BAC-445566' })
        .expect(200);
      expect((await lista()).map((d) => d.id)).toEqual([dev.s3]);
      // una ejecutada que salió toda de la caja no tiene nada que transferir
      const todas = await comoJefa('get', `/api/devoluciones?sucursal_id=${ids.suc}`).expect(200);
      const s1 = (todas.body.devoluciones as DevolucionResumen[]).find((d) => d.id === dev.s1);
      expect(s1).toMatchObject({ monto_transferencia: '0.00', por_transferir: false });
    });
  });
});
