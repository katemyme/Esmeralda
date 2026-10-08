import type { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { TurnoDetalle } from '../src/caja/caja.service';
import type { PerforacionCatalogo } from '../src/perforaciones/perforaciones.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import { hoyEnManagua, rangoDelPeriodo, sumarDias } from '../src/reportes/periodo';
import type { Fila, Reporte, Seccion } from '../src/reportes/reporte';
import {
  comoBytes,
  cookiePuesta,
  crearApp,
  crearUsuarioDePrueba,
  tokenDeAcceso,
} from './utilidades';

// Reportes (B7) sobre una sucursal propia con un día de trabajo conocido: cuatro ventas (una en
// dólares, una con sobreprecio, un paquete con promoción y un solo servicio), una anulada, tres
// mermas y un cierre con faltante. Además dos ventas antiguas (de hace 8 y 40 días) para los
// reportes por semana y por mes. Las pruebas van en orden y comparten estado.

const SUCURSAL = 'Sucursal Reportes e2e';
const NOTA_TURNOS = 'No incluye las ventas de los turnos de caja que siguen abiertos.';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function seccion(reporte: Reporte, clave: string): Seccion {
  const encontrada = reporte.secciones.find((s) => s.clave === clave);
  if (!encontrada) throw new Error(`El reporte ${reporte.clave} no tiene la sección ${clave}`);
  return encontrada;
}

const claves = (s: Seccion) => s.columnas.map((c) => c.clave);

describe('Reportes', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const hoy = hoyEnManagua();
  const ids = {
    jefa: 0,
    eva: 0,
    vera: 0,
    rita: 0,
    suc: 0,
    caja: 0,
    lam: 0,
    turno: 0,
    promocion: 0,
  };
  const pieza = { aro: 0, cadena: 0, paquete: 0, servicio: 0 };
  /** La jefa (admin), Eva (encargada), Vera (vendedora) y Rita (solo REPORTES_VER). */
  const jefa = { acceso: '' };
  const eva = { acceso: '' };
  const vera = { acceso: '' };
  const rita = { acceso: '' };
  /** US$ 10 en córdobas, en centavos, al tipo de cambio del día. */
  let diezDolares = 0;

  const centavos = (n: number) => (n / 100).toFixed(2);

  function con(acceso: string, ruta: string) {
    return request(http).get(ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function enviar(acceso: string, metodo: 'post' | 'put', ruta: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  /** El reporte en JSON, con la sucursal de la prueba salvo que la ruta diga otra cosa. */
  async function reporte(acceso: string, ruta: string, consulta = ''): Promise<Reporte> {
    const { body } = await con(
      acceso,
      `/api/reportes/${ruta}?sucursal_id=${ids.suc}${consulta}`,
    ).expect(200);
    return body.reporte as Reporte;
  }

  async function descargar(acceso: string, ruta: string) {
    return con(acceso, `/api/reportes/${ruta}`).buffer(true).parse(comoBytes).expect(200);
  }

  function vender(acceso: string, cuerpo: Record<string, unknown>) {
    return enviar(acceso, 'post', '/api/ventas')
      .send({ clave_idempotencia: randomUUID(), ...cuerpo })
      .expect(201);
  }

  /** Una venta con fecha pasada, puesta directo en la base (la API siempre vende "ahora"). */
  async function ventaAntigua(numero: string, diasAtras: number, variante: number, precio: number) {
    await bd.transaccion(ids.jefa, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        insert into venta (numero, sucursal_id, turno_id, vendedor_id, fecha, subtotal, total, tipo_cambio)
        values (${numero}, ${ids.suc}, ${ids.turno}, ${ids.vera},
                now() - make_interval(days => ${diasAtras}::integer), ${precio}, ${precio}, 36.6243)
        returning id`.execute(trx);
      await sql`
        insert into venta_detalle (venta_id, variante_id, cantidad, precio_lista, precio_unitario, costo_unitario)
        values (${rows[0].id}, ${variante}, 1, ${precio}, ${precio}, 0)`.execute(trx);
      await sql`
        insert into venta_pago (venta_id, metodo_pago_id, moneda, monto, tipo_cambio, referencia)
        values (${rows[0].id}, (select id from metodo_pago where codigo = 'TARJETA'), 'NIO',
                ${precio}, 1, 'ANTIGUA')`.execute(trx);
    });
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const lam = await bd.db
      .selectFrom('sucursal')
      .select('id')
      .where('codigo', '=', 'LAM')
      .executeTakeFirstOrThrow();
    ids.lam = lam.id;

    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de reportes',
      username: 'jefa.rep',
      password: 'Reportes#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.rep', 'Reportes#2026');

    // Sucursal propia con su caja y su PC de caja
    const sucursal = await enviar(jefa.acceso, 'post', '/api/sucursales')
      .send({ codigo: 'RPT', nombre: SUCURSAL, direccion: 'Plaza de los reportes' })
      .expect(201);
    ids.suc = sucursal.body.sucursal.id;
    const conCaja = await enviar(jefa.acceso, 'post', `/api/sucursales/${ids.suc}/cajas`)
      .send({ nombre: 'Caja 1' })
      .expect(201);
    ids.caja = conCaja.body.sucursal.cajas[0].id;
    const equipo = await enviar(jefa.acceso, 'post', '/api/equipos')
      .send({
        nombre: 'PC de caja Reportes e2e',
        tipo: 'CAJA',
        sucursal_id: ids.suc,
        caja_id: ids.caja,
      })
      .expect(201);
    const pc = cookiePuesta(equipo, 'esmeralda_equipo')?.valor ?? '';

    // Un rol que solo ve reportes: sin CAJA_VER_DIFERENCIAS ni REPORTES_COSTOS
    await enviar(jefa.acceso, 'post', '/api/roles')
      .send({ codigo: 'ANALISTA_RPT', nombre: 'Analista de reportes e2e' })
      .expect(201);
    await enviar(jefa.acceso, 'put', '/api/roles/ANALISTA_RPT/permisos')
      .send({ permisos: ['REPORTES_VER'] })
      .expect(200);

    const actores: [string, string, string, { acceso: string }][] = [
      ['Eva Reportes', 'eva.rep', 'ENCARGADO', eva],
      ['Vera Reportes', 'vera.rep', 'VENDEDOR', vera],
      ['Rita Reportes', 'rita.rep', 'ANALISTA_RPT', rita],
    ];
    for (const [nombre, username, rol, sesion] of actores) {
      const id = await crearUsuarioDePrueba(app, {
        nombre,
        username,
        password: 'Reportes#2026',
        rol,
        sucursales: [ids.suc],
      });
      if (username === 'eva.rep') ids.eva = id;
      if (username === 'vera.rep') ids.vera = id;
      if (username === 'rita.rep') ids.rita = id;
      sesion.acceso = await tokenDeAcceso(app, username, 'Reportes#2026', pc);
    }

    // Catálogo propio: aro de titanio (C$300, costo C$100), cadena (C$1000, costo C$400) y una
    // perforación (servicio C$200; con el aro de titanio el paquete vale 200 + 300)
    const gamas = await con(jefa.acceso, '/api/gamas').expect(200);
    const titanio = (gamas.body.gamas as { id: number; nombre: string }[]).find(
      (g) => g.nombre === 'Titanio',
    );
    const categoria = await enviar(jefa.acceso, 'post', '/api/categorias')
      .send({ nombre: 'Joyas RPT' })
      .expect(201);
    const producto = await enviar(jefa.acceso, 'post', '/api/productos')
      .send({
        categoria_id: categoria.body.categoria.id,
        nombre: 'Joya RPT',
        variantes: [
          { sku: 'RPT-ARO', nombre: 'Aro', precio_venta: 300, costo: 100, gama_id: titanio?.id },
          { sku: 'RPT-CAD', nombre: 'Cadena', precio_venta: 1000, costo: 400 },
        ],
      })
      .expect(201);
    const variantes = (producto.body.producto as ProductoCatalogo).variantes;
    pieza.aro = variantes.find((v) => v.sku === 'RPT-ARO')?.id ?? 0;
    pieza.cadena = variantes.find((v) => v.sku === 'RPT-CAD')?.id ?? 0;
    for (const [variante, cantidad] of [
      [pieza.aro, 20],
      [pieza.cadena, 5],
    ]) {
      await enviar(jefa.acceso, 'post', '/api/inventario/movimientos')
        .send({
          sucursal_id: ids.suc,
          variante_id: variante,
          tipo: 'AJUSTE_POSITIVO',
          cantidad,
          motivo: 'Existencias para las pruebas de reportes',
        })
        .expect(201);
    }
    const perforacion = await enviar(jefa.acceso, 'post', '/api/perforaciones')
      .send({ codigo: 'RPR', nombre: 'Lóbulo RPT', precio_servicio: 200 })
      .expect(201);
    pieza.paquete = (perforacion.body.perforacion as PerforacionCatalogo).paquete_variante_id;
    pieza.servicio = (perforacion.body.perforacion as PerforacionCatalogo).servicio_variante_id;
    const promocion = await enviar(jefa.acceso, 'post', '/api/promociones')
      .send({ nombre: 'Promo RPT', tipo: 'PORCENTAJE', valor: 10 })
      .expect(201);
    ids.promocion = promocion.body.promocion.id;
    await enviar(jefa.acceso, 'put', `/api/promociones/${ids.promocion}/activa`)
      .send({ activa: true })
      .expect(200);

    const tipoCambio = await con(jefa.acceso, '/api/tipo-cambio').expect(200);
    diezDolares = Math.round(Number(tipoCambio.body.tipo_cambio.usd_a_nio) * 1000);

    // El día de trabajo
    const turno = await enviar(vera.acceso, 'post', '/api/caja/turno/abrir')
      .send({ inicial_nio: 1000 })
      .expect(201);
    ids.turno = turno.body.turno.id;
    // 1) dos aros, pagados con US$ 10 y el resto en córdobas
    await vender(vera.acceso, {
      items: [{ variante_id: pieza.aro, cantidad: 2 }],
      pagos: [
        { metodo: 'EFECTIVO', moneda: 'USD', monto: 10 },
        { metodo: 'EFECTIVO', monto: centavos(60000 - diezDolares) },
      ],
    });
    // 2) una cadena cobrada C$100 por encima de su precio, con tarjeta
    await vender(vera.acceso, {
      items: [{ variante_id: pieza.cadena, cantidad: 1, precio: 1100 }],
      pagos: [{ metodo: 'TARJETA', monto: 1100, referencia: 'V-1' }],
    });
    // 3) un paquete (perforación + aro) con la promoción del 10 %: C$500 − C$50, con vuelto
    await vender(vera.acceso, {
      items: [{ variante_id: pieza.paquete, cantidad: 1, piezas: [pieza.aro] }],
      pagos: [{ metodo: 'EFECTIVO', monto: 500 }],
      promocion_id: ids.promocion,
    });
    // 4) un aro que la encargada vende y después anula
    const anulada = await vender(eva.acceso, {
      items: [{ variante_id: pieza.aro, cantidad: 1 }],
      pagos: [{ metodo: 'EFECTIVO', monto: 300 }],
    });
    await enviar(eva.acceso, 'post', `/api/ventas/${anulada.body.venta.id}/anular`)
      .send({ motivo: 'La clienta se arrepintió' })
      .expect(200);
    // 5) una perforación de solo servicio, por transferencia
    await vender(eva.acceso, {
      items: [{ variante_id: pieza.servicio, cantidad: 1 }],
      pagos: [{ metodo: 'TRANSFERENCIA', monto: 200, referencia: 'T-1' }],
    });
    await enviar(jefa.acceso, 'put', `/api/promociones/${ids.promocion}/activa`)
      .send({ activa: false })
      .expect(200);
    // Ventas antiguas, en el mismo turno
    await ventaAntigua('RPT-ANTIGUA-40', 40, pieza.aro, 300);
    await ventaAntigua('RPT-ANTIGUA-08', 8, pieza.cadena, 1000);

    // Mermas: una aprobada (con el aro a C$100 de costo), una pendiente y una rechazada
    const merma = (variante: number, motivo: string) =>
      enviar(vera.acceso, 'post', '/api/mermas')
        .send({ sucursal_id: ids.suc, variante_id: variante, cantidad: 1, motivo })
        .expect(201);
    const aprobada = await merma(pieza.aro, 'Se dobló el aro al medirlo');
    await enviar(jefa.acceso, 'post', `/api/mermas/${aprobada.body.merma.id}/resolver`)
      .send({ aprobar: true })
      .expect(200);
    await merma(pieza.cadena, 'La cadena llegó sin broche');
    const rechazada = await merma(pieza.aro, 'No encuentro un aro del exhibidor');
    await enviar(jefa.acceso, 'post', `/api/mermas/${rechazada.body.merma.id}/resolver`)
      .send({ aprobar: false, comentario: 'Apareció en la vitrina' })
      .expect(200);
    // Después de aprobar la merma el aro sube de costo: el reporte debe conservar el de entonces
    await enviar(jefa.acceso, 'put', `/api/variantes/${pieza.aro}/precio`)
      .send({ costo: 150 })
      .expect(200);
    await enviar(jefa.acceso, 'put', '/api/inventario/stock-minimo')
      .send({ sucursal_id: ids.suc, variante_id: pieza.aro, stock_minimo: 20 })
      .expect(200);
    await enviar(jefa.acceso, 'put', '/api/inventario/stock-minimo')
      .send({ sucursal_id: ids.suc, variante_id: pieza.cadena, stock_minimo: 2 })
      .expect(200);
  });

  afterAll(async () => {
    // Las otras pruebas esperan solo los roles del sistema: el de esta prueba se elimina
    await enviar(jefa.acceso, 'put', `/api/usuarios/${ids.rita}`)
      .send({ nombre_completo: 'Rita Reportes', rol: 'VENDEDOR', sucursales: [ids.suc] })
      .expect(200);
    await request(http)
      .delete('/api/roles/ANALISTA_RPT')
      .set('Authorization', `Bearer ${jefa.acceso}`)
      .expect(204);
    await app.close();
  });

  it('sin sesión → 401; la vendedora no ve reportes → 403', async () => {
    const rutas = [
      'ventas',
      'ventas-por-vendedor',
      'ventas-por-sucursal',
      'cobros',
      'productos',
      'perforaciones',
      'gamas',
      'promociones',
      'sobreprecios',
      'piezas-en-paquetes',
      'compras-por-proveedor',
      'cierres',
      'mermas',
      'inventario-valorizado',
      'inventario-valorizado/meses',
      'por-reponer',
    ];
    for (const ruta of rutas) {
      await request(http).get(`/api/reportes/${ruta}`).expect(401);
      const { body } = await con(vera.acceso, `/api/reportes/${ruta}`).expect(403);
      expect(body.codigo).toBe('PERMISO_DENEGADO');
    }
  });

  describe('ventas', () => {
    const delDia: Fila = {
      ventas: 4,
      unidades: 5,
      descuentos: '50.00',
      venta_neta: '2350.00',
      sobreprecio: '100.00',
      ticket_promedio: '587.50',
    };

    it('el administrador ve el día con costo y margen', async () => {
      const r = await reporte(jefa.acceso, 'ventas');
      expect(r).toMatchObject({
        clave: 'ventas',
        titulo: 'Ventas por día',
        desde: hoy,
        hasta: hoy,
        sucursal: { id: ids.suc, codigo: 'RPT', nombre: SUCURSAL },
        notas: [],
      });
      const s = seccion(r, 'ventas');
      expect(s.columnas[0]).toEqual({ clave: 'periodo', titulo: 'Día', tipo: 'fecha' });
      expect(claves(s)).toEqual([
        'periodo',
        'ventas',
        'unidades',
        'descuentos',
        'venta_neta',
        'sobreprecio',
        'ticket_promedio',
        'costo',
        'margen',
        'margen_pct',
      ]);
      const conCostos = { ...delDia, costo: '700.00', margen: '1650.00', margen_pct: '70.2' };
      expect(s.filas).toEqual([{ periodo: hoy, ...conCostos }]);
      expect(s.totales).toEqual(conCostos);
    });

    it('la encargada ve lo mismo, sin costo ni margen', async () => {
      const s = seccion(await reporte(eva.acceso, 'ventas'), 'ventas');
      expect(claves(s)).toEqual([
        'periodo',
        'ventas',
        'unidades',
        'descuentos',
        'venta_neta',
        'sobreprecio',
        'ticket_promedio',
      ]);
      expect(s.filas).toEqual([{ periodo: hoy, ...delDia }]);
      expect(s.totales).toEqual(delDia);
      expect(JSON.stringify(s)).not.toMatch(/costo|margen/);
    });

    it('cada quien ve solo sus sucursales; una ajena responde 404', async () => {
      // Eva solo tiene esta sucursal: sin filtro ve lo mismo
      const { body } = await con(eva.acceso, '/api/reportes/ventas-por-sucursal').expect(200);
      const s = seccion(body.reporte as Reporte, 'sucursales');
      expect(body.reporte.sucursal).toBeNull();
      expect(s.filas).toEqual([{ sucursal: SUCURSAL, ...delDia }]);
      await con(eva.acceso, `/api/reportes/ventas?sucursal_id=${ids.lam}`)
        .expect(404)
        .expect({ codigo: 'NO_ENCONTRADO', mensaje: `La sucursal ${ids.lam} no existe` });
      await con(jefa.acceso, '/api/reportes/ventas?sucursal_id=999999').expect(404);
      await con(jefa.acceso, `/api/reportes/ventas?sucursal_id=${ids.lam}`).expect(200);
    });

    it('sin CAJA_VER_DIFERENCIAS no entran las ventas del turno que sigue abierto', async () => {
      const r = await reporte(rita.acceso, 'ventas');
      expect(r.notas).toEqual([NOTA_TURNOS]);
      const s = seccion(r, 'ventas');
      expect(s.filas).toEqual([]);
      expect(s.totales).toMatchObject({ ventas: 0, venta_neta: '0.00', ticket_promedio: null });
      // tampoco los cobros (con ellos se sabría cuánto efectivo debe haber) ni lo de cada vendedor
      const cobros = seccion(await reporte(rita.acceso, 'cobros'), 'cobros');
      expect(cobros.filas).toEqual([]);
      expect(cobros.totales).toEqual({ ventas: 0, monto_nio: '0.00' });
      const vendedores = seccion(await reporte(rita.acceso, 'ventas-por-vendedor'), 'vendedores');
      expect(vendedores.filas).toEqual([]);
      expect(vendedores.totales).toMatchObject({ ventas: 0, anuladas: 0 });
    });

    it('por vendedor, con las ventas que se le anularon', async () => {
      const s = seccion(await reporte(jefa.acceso, 'ventas-por-vendedor'), 'vendedores');
      expect(s.filas).toEqual([
        {
          vendedor: 'Vera Reportes',
          ventas: 3,
          unidades: 4,
          descuentos: '50.00',
          venta_neta: '2150.00',
          sobreprecio: '100.00',
          ticket_promedio: '716.67',
          costo: '700.00',
          margen: '1450.00',
          margen_pct: '67.4',
          anuladas: 0,
          total_anulado: '0.00',
        },
        {
          vendedor: 'Eva Reportes',
          ventas: 1,
          unidades: 1,
          descuentos: '0.00',
          venta_neta: '200.00',
          sobreprecio: '0.00',
          ticket_promedio: '200.00',
          costo: '0.00',
          margen: '200.00',
          margen_pct: '100.0',
          anuladas: 1,
          total_anulado: '300.00',
        },
      ]);
      expect(s.totales).toMatchObject({
        ventas: 4,
        venta_neta: '2350.00',
        margen: '1650.00',
        anuladas: 1,
        total_anulado: '300.00',
      });
    });

    it('cobros por método y moneda: el vuelto ya está restado y los dólares van con su equivalente', async () => {
      const s = seccion(await reporte(eva.acceso, 'cobros'), 'cobros');
      expect(s.filas).toEqual([
        {
          metodo: 'Efectivo',
          moneda: 'NIO',
          ventas: 2,
          monto: centavos(105000 - diezDolares), // (600 − US$10) + 500 − 50 de vuelto
          monto_nio: centavos(105000 - diezDolares),
        },
        {
          metodo: 'Efectivo',
          moneda: 'USD',
          ventas: 1,
          monto: '10.00',
          monto_nio: centavos(diezDolares),
        },
        { metodo: 'Tarjeta', moneda: 'NIO', ventas: 1, monto: '1100.00', monto_nio: '1100.00' },
        { metodo: 'Transferencia', moneda: 'NIO', ventas: 1, monto: '200.00', monto_nio: '200.00' },
      ]);
      // el total va solo en córdobas, y es lo vendido
      expect(s.totales).toEqual({ ventas: 4, monto_nio: '2350.00' });
    });

    it('productos más vendidos, perforaciones, gamas, promociones y sobreprecios', async () => {
      const productos = seccion(await reporte(jefa.acceso, 'productos'), 'productos');
      expect(productos.filas.map((f) => [f.sku, f.unidades, f.venta_neta, f.margen])).toEqual([
        ['RPT-ARO', 2, '600.00', '400.00'],
        ['RPT-CAD', 1, '1100.00', '700.00'],
        ['PAQ-RPR', 1, '450.00', '350.00'],
        ['SRV-RPR', 1, '200.00', '200.00'],
      ]);
      expect(productos.filas[0]).toMatchObject({
        producto: 'Joya RPT — Aro',
        categoria: 'Joyas RPT',
        costo: '200.00',
        margen_pct: '66.7',
      });
      const primero = seccion(await reporte(eva.acceso, 'productos', '&limite=1'), 'productos');
      expect(primero.filas).toEqual([
        {
          sku: 'RPT-ARO',
          producto: 'Joya RPT — Aro',
          categoria: 'Joyas RPT',
          unidades: 2,
          venta_neta: '600.00',
        },
      ]);

      const perforaciones = seccion(await reporte(jefa.acceso, 'perforaciones'), 'perforaciones');
      const lobulo = {
        con_pieza: 1,
        solo_servicio: 1,
        total: 2,
        venta_neta: '650.00',
        margen: '550.00',
      };
      expect(perforaciones.filas).toEqual([{ perforacion: 'Lóbulo RPT', ...lobulo }]);
      expect(perforaciones.totales).toEqual(lobulo);

      const gamas = seccion(await reporte(jefa.acceso, 'gamas'), 'gamas');
      expect(gamas.filas).toEqual([
        { gama: 'Titanio', paquetes: 1, venta_neta: '450.00', margen: '350.00' },
      ]);

      const promociones = seccion(await reporte(eva.acceso, 'promociones'), 'promociones');
      const promo = { ventas: 1, subtotal: '500.00', descuento: '50.00', total: '450.00' };
      expect(promociones.filas).toEqual([{ promocion: 'Promo RPT', ...promo }]);
      expect(promociones.totales).toEqual(promo);

      const sobreprecios = seccion(await reporte(eva.acceso, 'sobreprecios'), 'sobreprecios');
      expect(sobreprecios.filas).toEqual([
        {
          fecha: expect.any(String),
          numero: 'RPT-00000002',
          sucursal: SUCURSAL,
          vendedor: 'Vera Reportes',
          producto: 'Joya RPT — Cadena',
          cantidad: 1,
          precio_lista: '1000.00',
          precio_unitario: '1100.00',
          aumento_pct: '10.0',
          sobreprecio: '100.00',
        },
      ]);
      expect(sobreprecios.totales).toEqual({ cantidad: 1, sobreprecio: '100.00' });
    });

    it('piezas consumidas en paquetes: solo con REPORTES_COSTOS, al costo de cuando se vendieron', async () => {
      for (const acceso of [eva.acceso, rita.acceso]) {
        await con(acceso, '/api/reportes/piezas-en-paquetes').expect(403).expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere REPORTES_COSTOS',
        });
      }
      const r = await reporte(jefa.acceso, 'piezas-en-paquetes');
      expect(r).toMatchObject({
        clave: 'piezas-en-paquetes',
        titulo: 'Piezas consumidas en paquetes',
        desde: hoy,
        hasta: hoy,
        notas: [],
      });
      // Solo el aro que salió con la perforación: los dos que se vendieron sueltos no cuentan.
      // Su costo es el de la venta (C$100), aunque después haya subido a C$150.
      const aro = {
        sku: 'RPT-ARO',
        pieza: 'Joya RPT — Aro',
        gama: 'Titanio',
        unidades: 1,
        costo: '100.00',
      };
      const total = { unidades: 1, costo: '100.00' };
      expect(seccion(r, 'por_pieza').filas).toEqual([aro]);
      expect(seccion(r, 'por_pieza').totales).toEqual(total);
      expect(seccion(r, 'por_sucursal').filas).toEqual([{ sucursal: SUCURSAL, ...aro }]);
      expect(seccion(r, 'por_sucursal').totales).toEqual(total);

      const ayer = sumarDias(hoy, -1);
      const antes = await reporte(
        jefa.acceso,
        'piezas-en-paquetes',
        `&desde=${ayer}&hasta=${ayer}`,
      );
      expect(seccion(antes, 'por_pieza').filas).toEqual([]);
      expect(seccion(antes, 'por_pieza').totales).toEqual({ unidades: 0, costo: '0.00' });
    });

    it('el diario, el semanal (lunes a domingo) y el mensual; y un rango partido por semana o por mes', async () => {
      const semana = rangoDelPeriodo('semana', hoy);
      const mes = rangoDelPeriodo('mes', hoy);
      const hace8 = sumarDias(hoy, -8);
      const hace40 = sumarDias(hoy, -40);

      const semanal = await reporte(jefa.acceso, 'ventas', '&periodo=semana');
      expect(semanal).toMatchObject(semana);
      expect(seccion(semanal, 'ventas').filas).toEqual([expect.objectContaining({ periodo: hoy })]);
      expect(seccion(semanal, 'ventas').totales).toMatchObject({
        ventas: 4,
        venta_neta: '2350.00',
      });

      // el mes de hoy: entra la venta de hace 8 días solo si cae en este mes
      const mensual = await reporte(jefa.acceso, 'ventas', '&periodo=mes&agrupar=mes');
      const enEsteMes = hace8 >= mes.desde;
      expect(mensual).toMatchObject({ ...mes, titulo: 'Ventas por mes' });
      expect(seccion(mensual, 'ventas').columnas[0]).toEqual({
        clave: 'periodo',
        titulo: 'Mes',
        tipo: 'mes',
      });
      expect(seccion(mensual, 'ventas').filas).toEqual([
        expect.objectContaining({
          periodo: mes.desde,
          ventas: enEsteMes ? 5 : 4,
          venta_neta: enEsteMes ? '3350.00' : '2350.00',
        }),
      ]);

      // un periodo que no es el de hoy: la semana de la venta de hace 40 días
      const antigua = await reporte(jefa.acceso, 'ventas', `&periodo=semana&fecha=${hace40}`);
      expect(antigua).toMatchObject(rangoDelPeriodo('semana', hace40));
      expect(seccion(antigua, 'ventas').filas).toEqual([
        expect.objectContaining({ periodo: hace40, ventas: 1, venta_neta: '300.00' }),
      ]);

      // un rango cualquiera, una fila por semana (la fecha de cada fila es su lunes)
      const rango = `&desde=${sumarDias(hoy, -45)}&hasta=${hoy}`;
      const porSemana = seccion(
        await reporte(jefa.acceso, 'ventas', `${rango}&agrupar=semana`),
        'ventas',
      );
      expect(porSemana.columnas[0].titulo).toBe('Semana del');
      expect(porSemana.filas.map((f) => [f.periodo, f.ventas, f.venta_neta])).toEqual([
        [rangoDelPeriodo('semana', hace40).desde, 1, '300.00'],
        [rangoDelPeriodo('semana', hace8).desde, 1, '1000.00'],
        [semana.desde, 4, '2350.00'],
      ]);
      expect(porSemana.totales).toMatchObject({ ventas: 6, venta_neta: '3650.00' });

      const porMes = seccion(
        await reporte(jefa.acceso, 'ventas', `${rango}&agrupar=mes`),
        'ventas',
      );
      const esperado = new Map<string, number>();
      for (const [dia, monto] of [
        [hace40, 300],
        [hace8, 1000],
        [hoy, 2350],
      ] as const) {
        const inicio = rangoDelPeriodo('mes', dia).desde;
        esperado.set(inicio, (esperado.get(inicio) ?? 0) + monto);
      }
      expect(porMes.filas.map((f) => [f.periodo, f.venta_neta])).toEqual(
        [...esperado].map(([inicio, monto]) => [inicio, monto.toFixed(2)]),
      );
    });

    it('filtros inválidos → 400 con el campo', async () => {
      const casos: [string, string, string][] = [
        ['periodo=anual', 'periodo', 'periodo debe ser dia, semana o mes'],
        ['fecha=ayer', 'fecha', 'fecha debe ser una fecha con el formato AAAA-MM-DD'],
        [`desde=${hoy}`, 'hasta', 'Indique desde y hasta juntos'],
        [`hasta=${hoy}`, 'desde', 'Indique desde y hasta juntos'],
        [
          `desde=${hoy}&hasta=${sumarDias(hoy, -1)}`,
          'hasta',
          'hasta no puede ser anterior a desde',
        ],
        [
          `desde=${sumarDias(hoy, -400)}&hasta=${hoy}`,
          'hasta',
          'El rango no puede pasar de 366 días',
        ],
        [
          `desde=${hoy}&hasta=${hoy}&periodo=mes`,
          'periodo',
          'Use periodo y fecha, o desde y hasta: no los dos',
        ],
        ['agrupar=hora', 'agrupar', 'agrupar debe ser dia, semana o mes'],
        ['formato=csv', 'formato', 'formato debe ser json, xlsx o pdf'],
        ['sucursal_id=todas', 'sucursal_id', 'sucursal_id debe ser el id de una sucursal'],
      ];
      for (const [consulta, campo, mensaje] of casos) {
        const { body } = await con(jefa.acceso, `/api/reportes/ventas?${consulta}`).expect(400);
        expect(body).toMatchObject({ codigo: 'DATOS_INVALIDOS', errores: [{ campo, mensaje }] });
      }
      await con(jefa.acceso, '/api/reportes/productos?limite=500').expect(400);
      await con(jefa.acceso, '/api/reportes/inventario-valorizado?mes=2026-13').expect(400);
    });
  });

  describe('mermas', () => {
    it('suman las aprobadas, al costo que tenían al aprobarse; pendientes y rechazadas van aparte', async () => {
      const r = await reporte(jefa.acceso, 'mermas');
      expect(r.secciones.map((s) => s.clave)).toEqual([
        'por_sucursal',
        'aprobadas',
        'pendientes',
        'rechazadas',
      ]);
      const resumen = { mermas: 1, cantidad: 1, valor_costo: '100.00' };
      expect(seccion(r, 'por_sucursal').filas).toEqual([{ sucursal: SUCURSAL, ...resumen }]);
      expect(seccion(r, 'por_sucursal').totales).toEqual(resumen);
      // el aro ya cuesta C$150, pero la merma se valora con los C$100 de cuando se aprobó
      expect(seccion(r, 'aprobadas').filas).toEqual([
        {
          fecha: expect.any(String),
          sucursal: SUCURSAL,
          sku: 'RPT-ARO',
          producto: 'Joya RPT — Aro',
          cantidad: 1,
          costo_unitario: '100.00',
          valor_costo: '100.00',
          motivo: 'Se dobló el aro al medirlo',
          reportada_por: 'Vera Reportes',
          resuelta_por: 'Jefa de reportes',
        },
      ]);
      expect(seccion(r, 'aprobadas').totales).toEqual({ cantidad: 1, valor_costo: '100.00' });
      expect(seccion(r, 'pendientes').filas).toEqual([
        expect.objectContaining({ sku: 'RPT-CAD', cantidad: 1, reportada_por: 'Vera Reportes' }),
      ]);
      expect(seccion(r, 'rechazadas').filas).toEqual([
        expect.objectContaining({
          sku: 'RPT-ARO',
          motivo: 'No encuentro un aro del exhibidor',
          resuelta_por: 'Jefa de reportes',
          comentario: 'Apareció en la vitrina',
        }),
      ]);
    });

    it('la encargada las ve en cantidades, sin su valor', async () => {
      const r = await reporte(eva.acceso, 'mermas');
      expect(seccion(r, 'por_sucursal').filas).toEqual([
        { sucursal: SUCURSAL, mermas: 1, cantidad: 1 },
      ]);
      expect(claves(seccion(r, 'aprobadas'))).not.toContain('valor_costo');
      expect(seccion(r, 'aprobadas').totales).toEqual({ cantidad: 1 });
      expect(JSON.stringify(r)).not.toMatch(/costo/);
      // hasta ayer no había mermas en esta sucursal: ni aprobadas ni pendientes
      const ayer = sumarDias(hoy, -1);
      const antes = await reporte(
        eva.acceso,
        'mermas',
        `&desde=${sumarDias(hoy, -30)}&hasta=${ayer}`,
      );
      expect(seccion(antes, 'aprobadas').filas).toEqual([]);
      expect(seccion(antes, 'pendientes').filas).toEqual([]);
      // en un rango posterior no hay aprobadas, pero la que sigue sin resolver se sigue listando
      const manana = sumarDias(hoy, 1);
      const despues = await reporte(eva.acceso, 'mermas', `&desde=${manana}&hasta=${manana}`);
      expect(seccion(despues, 'aprobadas').filas).toEqual([]);
      expect(seccion(despues, 'pendientes').filas).toHaveLength(1);
    });
  });

  describe('inventario', () => {
    // 20 aros − 2 − 1 del paquete − 1 de merma (el de la venta anulada volvió) = 16; 5 cadenas − 1 = 4
    const valor = { unidades: 20, valor_costo: '4000.00', valor_venta: '8800.00' };

    it('inventario valorizado: solo con REPORTES_COSTOS, al costo y al precio de hoy', async () => {
      await con(eva.acceso, '/api/reportes/inventario-valorizado').expect(403).expect({
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere REPORTES_COSTOS',
      });
      const r = await reporte(jefa.acceso, 'inventario-valorizado');
      expect(r).toMatchObject({
        titulo: 'Inventario valorizado',
        desde: null,
        hasta: null,
        notas: ['Existencias de este momento, al costo y al precio de venta actuales.'],
      });
      expect(seccion(r, 'por_ubicacion').filas).toEqual([{ sucursal: SUCURSAL, ...valor }]);
      expect(seccion(r, 'por_ubicacion').totales).toEqual(valor);
      expect(seccion(r, 'por_categoria').filas).toEqual([
        { sucursal: SUCURSAL, categoria: 'Joyas RPT', ...valor },
      ]);
      // sin filtro entran la bodega y las demás sucursales
      const { body } = await con(jefa.acceso, '/api/reportes/inventario-valorizado').expect(200);
      const ubicaciones = seccion(body.reporte as Reporte, 'por_ubicacion').filas;
      expect(ubicaciones.map((f) => f.sucursal)).toEqual(
        expect.arrayContaining([SUCURSAL, 'Bodega central']),
      );
    });

    it('con ?mes= entrega la foto del cierre de ese mes', async () => {
      const mes = hoy.slice(0, 7);
      // La foto de este mes como la tomaría la tarea al empezar el mes que viene
      await sql`delete from inventario_cierre_mensual where mes = ${`${mes}-01`}::date`.execute(
        bd.db,
      );
      await sql`select fn_foto_inventario_mensual(now() + interval '1 month')`.execute(bd.db);

      const r = await reporte(jefa.acceso, 'inventario-valorizado', `&mes=${mes}`);
      expect(r.titulo).toBe(
        `Inventario valorizado al cierre de ${mes.slice(5)}/${mes.slice(0, 4)}`,
      );
      expect(r.notas).toEqual([expect.stringMatching(/^Foto tomada el \d{2}\/\d{2}\/\d{4} /)]);
      expect(seccion(r, 'por_ubicacion').filas).toEqual([{ sucursal: SUCURSAL, ...valor }]);
      expect(seccion(r, 'por_categoria').filas).toEqual([
        { sucursal: SUCURSAL, categoria: 'Joyas RPT', ...valor },
      ]);
      const meses = await con(jefa.acceso, '/api/reportes/inventario-valorizado/meses').expect(200);
      expect(meses.body.meses).toContain(mes);

      const sinFoto = await reporte(jefa.acceso, 'inventario-valorizado', '&mes=2001-01');
      expect(sinFoto.notas).toEqual(['No hay una foto guardada del cierre de ese mes.']);
      expect(seccion(sinFoto, 'por_ubicacion').filas).toEqual([]);
    });

    it('por reponer: lo que está en su mínimo o por debajo', async () => {
      const aro = {
        sucursal: SUCURSAL,
        categoria: 'Joyas RPT',
        sku: 'RPT-ARO',
        producto: 'Joya RPT — Aro',
        cantidad: 16,
        stock_minimo: 20,
        faltante: 4,
        en_transito: 0,
      };
      const r = await reporte(eva.acceso, 'por-reponer');
      expect(r).toMatchObject({ desde: null, hasta: null });
      // la encargada no sabe cuánto hay en la bodega
      expect(claves(seccion(r, 'por_reponer'))).not.toContain('en_bodega');
      expect(seccion(r, 'por_reponer').filas).toEqual([aro]); // la cadena (4, mínimo 2) no sale
      const admin = seccion(await reporte(jefa.acceso, 'por-reponer'), 'por_reponer');
      expect(admin.filas).toEqual([{ ...aro, en_bodega: 0 }]);
    });
  });

  describe('compras por proveedor', () => {
    // Tres compras confirmadas con facturas de marzo y abril de 2019 (nadie más compra en esas
    // fechas) y una en borrador, de piezas propias para no mover el costo de las demás pruebas
    const RANGO = '&desde=2019-03-01&hasta=2019-04-30';
    const deA = {
      proveedor: 'Proveedor A RPT',
      moneda: 'USD',
      compras: 2,
      piezas_facturadas: 15,
      piezas_recibidas: 14,
      faltantes: 1,
      total_factura: '40.00',
      total_factura_nio: '1460.00', // US$40 × 36.50
      gastos_nio: '146.00', // US$4 de courier
      costo_total_nio: '1606.00',
      gastos_pct: '10.0',
    };
    const deB = {
      proveedor: 'Proveedor B RPT',
      moneda: 'NIO',
      compras: 1,
      piezas_facturadas: 20,
      piezas_recibidas: 20,
      faltantes: 0,
      total_factura: '1000.00',
      total_factura_nio: '1000.00',
      gastos_nio: '100.00',
      costo_total_nio: '1100.00',
      gastos_pct: '10.0',
    };
    const total = {
      compras: 3,
      piezas_facturadas: 35,
      piezas_recibidas: 34,
      faltantes: 1,
      total_factura: null, // dólares y córdobas no se suman
      total_factura_nio: '2460.00',
      gastos_nio: '246.00',
      costo_total_nio: '2706.00',
      gastos_pct: '10.0',
    };

    beforeAll(async () => {
      const proveedor = async (nombre: string, moneda: string) => {
        const { body } = await enviar(jefa.acceso, 'post', '/api/proveedores')
          .send({ nombre, moneda_habitual: moneda })
          .expect(201);
        return body.proveedor.id as number;
      };
      const a = await proveedor('Proveedor A RPT', 'USD');
      const b = await proveedor('Proveedor B RPT', 'NIO');
      const categoria = await enviar(jefa.acceso, 'post', '/api/categorias')
        .send({ nombre: 'Compras RPT' })
        .expect(201);
      const producto = await enviar(jefa.acceso, 'post', '/api/productos')
        .send({
          categoria_id: categoria.body.categoria.id,
          nombre: 'Insumo RPT',
          variantes: [
            { sku: 'RPT-INS1', nombre: 'Uno', precio_venta: 1000 },
            { sku: 'RPT-INS2', nombre: 'Dos', precio_venta: 1000 },
          ],
        })
        .expect(201);
      const [uno, dos] = (producto.body.producto as ProductoCatalogo).variantes.map((v) => v.id);

      const comprar = async (cuerpo: Record<string, unknown>, confirmar = true) => {
        const { body } = await enviar(jefa.acceso, 'post', '/api/compras').send(cuerpo).expect(201);
        if (confirmar) {
          await enviar(jefa.acceso, 'post', `/api/compras/${body.compra.id}/confirmar`).expect(200);
        }
      };
      await comprar({
        proveedor_id: a,
        factura_numero: 'RPT-A1',
        fecha_factura: '2019-03-10',
        moneda: 'USD',
        tipo_cambio: 36.5,
        lineas: [
          { variante_id: uno, cantidad_facturada: 10, costo_unitario: 2, cantidad_recibida: 9 },
        ],
        gastos: [{ concepto: 'COURIER', moneda: 'USD', monto: 4 }],
      });
      await comprar({
        proveedor_id: a,
        factura_numero: 'RPT-A2',
        fecha_factura: '2019-03-25',
        moneda: 'USD',
        tipo_cambio: 36.5,
        lineas: [{ variante_id: dos, cantidad_facturada: 5, costo_unitario: 4 }],
      });
      await comprar({
        proveedor_id: b,
        factura_numero: 'RPT-B1',
        fecha_factura: '2019-04-02',
        moneda: 'NIO',
        lineas: [{ variante_id: uno, cantidad_facturada: 20, costo_unitario: 50 }],
        gastos: [{ concepto: 'ADUANA', moneda: 'NIO', monto: 100 }],
      });
      // en borrador: no entra al reporte
      await comprar(
        {
          proveedor_id: b,
          factura_numero: 'RPT-B2',
          fecha_factura: '2019-04-05',
          moneda: 'NIO',
          lineas: [{ variante_id: dos, cantidad_facturada: 3, costo_unitario: 10 }],
        },
        false,
      );
    });

    it('solo con REPORTES_COSTOS', async () => {
      for (const acceso of [eva.acceso, rita.acceso]) {
        await con(acceso, '/api/reportes/compras-por-proveedor').expect(403).expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere REPORTES_COSTOS',
        });
      }
    });

    it('las confirmadas del rango por proveedor y moneda, con sus gastos de importación', async () => {
      const r = await reporte(jefa.acceso, 'compras-por-proveedor', RANGO);
      expect(r).toMatchObject({
        clave: 'compras-por-proveedor',
        titulo: 'Compras por proveedor',
        desde: '2019-03-01',
        hasta: '2019-04-30',
        sucursal: null, // las compras no son de una sucursal: todas entran a la bodega
        notas: [
          'Compras confirmadas, por la fecha de su factura. Todas entran a la bodega central.',
        ],
      });
      const s = seccion(r, 'por_proveedor');
      expect(claves(s)).toEqual([
        'proveedor',
        'moneda',
        'compras',
        'piezas_facturadas',
        'piezas_recibidas',
        'faltantes',
        'total_factura',
        'total_factura_nio',
        'gastos_nio',
        'costo_total_nio',
        'gastos_pct',
      ]);
      expect(s.filas).toEqual([deA, deB]); // primero el que más costó
      expect(s.totales).toEqual(total);
    });

    it('por mes, y cada compra con su factura', async () => {
      const r = await reporte(jefa.acceso, 'compras-por-proveedor', RANGO);
      expect(seccion(r, 'por_mes').columnas[0]).toEqual({
        clave: 'mes',
        titulo: 'Mes',
        tipo: 'mes',
      });
      expect(seccion(r, 'por_mes').filas).toEqual([
        { mes: '2019-03-01', ...deA },
        { mes: '2019-04-01', ...deB },
      ]);
      expect(seccion(r, 'por_mes').totales).toEqual(total);

      const compras = seccion(r, 'compras');
      expect(compras.filas).toEqual([
        {
          fecha_factura: '2019-03-10',
          proveedor: 'Proveedor A RPT',
          factura_numero: 'RPT-A1',
          moneda: 'USD',
          piezas_facturadas: 10,
          piezas_recibidas: 9,
          faltantes: 1,
          total_factura: '20.00',
          total_factura_nio: '730.00',
          gastos_nio: '146.00',
          costo_total_nio: '876.00',
        },
        expect.objectContaining({ factura_numero: 'RPT-A2', costo_total_nio: '730.00' }),
        expect.objectContaining({ factura_numero: 'RPT-B1', costo_total_nio: '1100.00' }),
      ]);
      expect(compras.totales).toEqual({
        piezas_facturadas: 35,
        piezas_recibidas: 34,
        faltantes: 1,
        total_factura: null,
        total_factura_nio: '2460.00',
        gastos_nio: '246.00',
        costo_total_nio: '2706.00',
      });
    });

    it('el rango va por la fecha de la factura', async () => {
      const marzo = await reporte(
        jefa.acceso,
        'compras-por-proveedor',
        '&periodo=mes&fecha=2019-03-15',
      );
      expect(marzo).toMatchObject({ desde: '2019-03-01', hasta: '2019-03-31' });
      expect(seccion(marzo, 'por_proveedor').filas).toEqual([deA]);
      expect(seccion(marzo, 'compras').filas).toHaveLength(2);
      const vacio = await reporte(
        jefa.acceso,
        'compras-por-proveedor',
        '&desde=2018-01-01&hasta=2018-12-31',
      );
      expect(seccion(vacio, 'por_proveedor').filas).toEqual([]);
      expect(seccion(vacio, 'por_proveedor').totales).toMatchObject({
        compras: 0,
        costo_total_nio: '0.00',
        gastos_pct: null,
      });
      const { body } = await con(
        jefa.acceso,
        '/api/reportes/compras-por-proveedor?desde=2019-04-30&hasta=2019-03-01',
      ).expect(400);
      expect(body.errores).toEqual([
        { campo: 'hasta', mensaje: 'hasta no puede ser anterior a desde' },
      ]);
    });
  });

  describe('cierres de caja', () => {
    let detalle: TurnoDetalle;

    it('se cierra con un faltante: un reconteo y después la justificación', async () => {
      const conteo = {
        efectivo: [
          { moneda: 'NIO', valor: 1, cantidad: 1400 },
          { moneda: 'USD', valor: 10, cantidad: 1 },
        ],
        no_efectivo: [
          { metodo: 'TARJETA', monto: 2400 }, // 1100 de hoy + las dos ventas antiguas
          { metodo: 'TRANSFERENCIA', monto: 200 },
        ],
      };
      await enviar(vera.acceso, 'post', '/api/caja/turno/cerrar').send(conteo).expect(422);
      await enviar(vera.acceso, 'post', '/api/caja/turno/cerrar')
        .send({ ...conteo, justificacion: 'Se pagó el agua del mes sin anotar el egreso' })
        .expect(200);
      const { body } = await con(jefa.acceso, `/api/turnos/${ids.turno}`).expect(200);
      detalle = body.turno as TurnoDetalle;
      // faltan (1000 + 600 − US$10 + 450) − 1400 córdobas
      expect(detalle.diferencia_nio).toBe(centavos(140000 - (205000 - diezDolares)));
    });

    it('el reporte trae lo esperado, lo contado y la diferencia de cada cierre', async () => {
      await con(rita.acceso, '/api/reportes/cierres').expect(403).expect({
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere CAJA_VER_DIFERENCIAS',
      });
      const faltante = centavos(205000 - diezDolares - 140000);
      for (const acceso of [jefa.acceso, eva.acceso]) {
        const r = await reporte(acceso, 'cierres');
        expect(seccion(r, 'resumen').filas).toEqual([
          {
            cierres: 1,
            con_diferencia: 1,
            con_reconteo: 1,
            forzados: 0,
            faltante_nio: faltante,
            sobrante_nio: '0.00',
            faltante_usd: '0.00',
            sobrante_usd: '0.00',
          },
        ]);
        expect(seccion(r, 'cierres').filas).toEqual([
          {
            sucursal: SUCURSAL,
            caja: 'Caja 1',
            fecha_cierre: expect.any(String),
            cerrado_por: 'Vera Reportes',
            ventas: 6,
            total_vendido: '3650.00',
            esperado_nio: centavos(465000 - diezDolares), // efectivo + tarjeta + transferencia
            contado_nio: '4000.00',
            diferencia_nio: detalle.diferencia_nio,
            esperado_usd: '10.00',
            contado_usd: '10.00',
            diferencia_usd: '0.00',
            hubo_reconteo: true,
            cierre_forzado: false,
            justificacion: 'Se pagó el agua del mes sin anotar el egreso',
          },
        ]);
        expect(seccion(r, 'cierres').totales).toEqual({
          ventas: 6,
          total_vendido: '3650.00',
          diferencia_nio: detalle.diferencia_nio,
          diferencia_usd: '0.00',
        });
      }
      // ayer no se cerró ninguna caja en esta sucursal
      const ayer = sumarDias(hoy, -1);
      const antes = await reporte(jefa.acceso, 'cierres', `&desde=${ayer}&hasta=${ayer}`);
      expect(seccion(antes, 'cierres').filas).toEqual([]);
      expect(seccion(antes, 'resumen').filas[0]).toMatchObject({
        cierres: 0,
        faltante_nio: '0.00',
      });
    });

    it('cerrado el turno, sus ventas ya entran en los reportes de quien no ve las diferencias', async () => {
      const s = seccion(await reporte(rita.acceso, 'ventas'), 'ventas');
      expect(s.filas).toEqual([expect.objectContaining({ ventas: 4, venta_neta: '2350.00' })]);
      expect(claves(s)).not.toContain('margen');
      const cobros = seccion(await reporte(rita.acceso, 'cobros'), 'cobros');
      expect(cobros.totales).toEqual({ ventas: 4, monto_nio: '2350.00' });
    });
  });

  describe('exportación', () => {
    async function libro(contenido: Buffer): Promise<ExcelJS.Workbook> {
      const leido = new ExcelJS.Workbook();
      await leido.xlsx.load(contenido as unknown as ExcelJS.Buffer);
      return leido;
    }

    /** Las filas de una hoja a partir de la de títulos de columna (la que empieza con `primera`). */
    function tabla(hoja: ExcelJS.Worksheet, primera: string): unknown[][] {
      const filas: unknown[][] = [];
      let dentro = false;
      hoja.eachRow((fila) => {
        const valores = (fila.values as unknown[]).slice(1);
        if (valores[0] === primera) dentro = true;
        if (dentro) filas.push(valores);
      });
      return filas;
    }

    it('?formato=xlsx: el mismo reporte como libro de Excel, con números y fechas de verdad', async () => {
      const ruta = `ventas-por-vendedor?sucursal_id=${ids.suc}&formato=xlsx`;
      const respuesta = await descargar(jefa.acceso, ruta);
      expect(respuesta.headers['content-type']).toBe(XLSX);
      expect(respuesta.headers['content-disposition']).toBe(
        `attachment; filename="ventas-por-vendedor_${hoy}.xlsx"`,
      );
      const hoja = (await libro(respuesta.body as Buffer)).worksheets[0];
      expect(hoja.name).toBe('Ventas por vendedor');
      expect(hoja.getCell('A1').value).toBe('Ventas por vendedor');
      expect(hoja.getCell('A3').value).toBe(`Sucursal: ${SUCURSAL}`);
      expect(tabla(hoja, 'Vendedor')).toEqual([
        [
          'Vendedor',
          'Ventas',
          'Unidades',
          'Descuentos',
          'Venta neta',
          'Sobreprecio',
          'Ticket promedio',
          'Costo',
          'Margen',
          'Margen %',
          'Anuladas',
          'Monto anulado',
        ],
        ['Vera Reportes', 3, 4, 50, 2150, 100, 716.67, 700, 1450, 67.4, 0, 0],
        ['Eva Reportes', 1, 1, 0, 200, 0, 200, 0, 200, 100, 1, 300],
        ['Total', 4, 5, 50, 2350, 100, 587.5, 700, 1650, 70.2, 1, 300],
      ]);

      // la encargada descarga el suyo sin las columnas de costo
      const deEva = await descargar(eva.acceso, ruta);
      const titulos = tabla((await libro(deEva.body as Buffer)).worksheets[0], 'Vendedor')[0];
      expect(titulos).not.toContain('Costo');
      expect(titulos).not.toContain('Margen');
      expect(titulos).toHaveLength(9);
    });

    it('un reporte con varias secciones lleva una hoja por sección; las fechas son fechas', async () => {
      const semana = rangoDelPeriodo('semana', hoy);
      const respuesta = await descargar(
        jefa.acceso,
        `mermas?sucursal_id=${ids.suc}&periodo=semana&formato=xlsx`,
      );
      expect(respuesta.headers['content-disposition']).toBe(
        `attachment; filename="mermas_${semana.desde}_${semana.hasta}.xlsx"`,
      );
      const mermas = await libro(respuesta.body as Buffer);
      expect(mermas.worksheets.map((h) => h.name)).toEqual([
        'Mermas aprobadas por ubicación',
        'Mermas aprobadas',
        'Pendientes de aprobar',
        'Rechazadas',
      ]);
      const aprobadas = tabla(mermas.worksheets[1], 'Aprobada');
      expect(aprobadas[1][0]).toBeInstanceOf(Date);
      expect(aprobadas[1].slice(1, 7)).toEqual([
        SUCURSAL,
        'RPT-ARO',
        'Joya RPT — Aro',
        1,
        100,
        100,
      ]);

      const ventas = await descargar(
        jefa.acceso,
        `ventas?sucursal_id=${ids.suc}&desde=${sumarDias(hoy, -45)}&hasta=${hoy}&formato=xlsx`,
      );
      const dias = tabla((await libro(ventas.body as Buffer)).worksheets[0], 'Día');
      expect(dias).toHaveLength(5); // títulos, tres días con ventas y el total
      expect(dias[3][0]).toEqual(new Date(`${hoy}T00:00:00Z`));
      expect(dias[4].slice(0, 2)).toEqual(['Total', 6]);
    });

    it('compras por proveedor y piezas en paquetes también se descargan en Excel', async () => {
      const respuesta = await descargar(
        jefa.acceso,
        'compras-por-proveedor?desde=2019-03-01&hasta=2019-04-30&formato=xlsx',
      );
      expect(respuesta.headers['content-type']).toBe(XLSX);
      expect(respuesta.headers['content-disposition']).toBe(
        'attachment; filename="compras-por-proveedor_2019-03-01_2019-04-30.xlsx"',
      );
      const compras = await libro(respuesta.body as Buffer);
      expect(compras.worksheets.map((h) => h.name)).toEqual([
        'Compras por proveedor',
        'Por mes y proveedor',
        'Compras confirmadas',
      ]);
      expect(tabla(compras.worksheets[0], 'Proveedor')).toEqual([
        [
          'Proveedor',
          'Moneda',
          'Compras',
          'Piezas facturadas',
          'Piezas recibidas',
          'Faltantes',
          'Factura en su moneda',
          'Factura en C$',
          'Gastos de importación C$',
          'Costo total C$',
          'Gastos sobre factura %',
        ],
        ['Proveedor A RPT', 'USD', 2, 15, 14, 1, 40, 1460, 146, 1606, 10],
        ['Proveedor B RPT', 'NIO', 1, 20, 20, 0, 1000, 1000, 100, 1100, 10],
        // sin suma de las facturas en su moneda (mezcla dólares y córdobas): la celda va vacía
        ['Total', undefined, 3, 35, 34, 1, undefined, 2460, 246, 2706, 10],
      ]);
      const porMes = tabla(compras.worksheets[1], 'Mes');
      expect(porMes[1].slice(0, 3)).toEqual([
        new Date('2019-03-01T00:00:00Z'),
        'Proveedor A RPT',
        'USD',
      ]);
      const facturas = tabla(compras.worksheets[2], 'Fecha de la factura');
      expect(facturas[1].slice(0, 3)).toEqual([
        new Date('2019-03-10T00:00:00Z'),
        'Proveedor A RPT',
        'RPT-A1',
      ]);

      const piezas = await descargar(
        jefa.acceso,
        `piezas-en-paquetes?sucursal_id=${ids.suc}&formato=xlsx`,
      );
      expect(piezas.headers['content-disposition']).toBe(
        `attachment; filename="piezas-en-paquetes_${hoy}.xlsx"`,
      );
      const hojas = (await libro(piezas.body as Buffer)).worksheets;
      expect(hojas.map((h) => h.name)).toEqual(['Piezas consumidas en paquetes', 'Por sucursal']);
      expect(tabla(hojas[1], 'Sucursal')).toEqual([
        ['Sucursal', 'SKU', 'Pieza', 'Gama', 'Unidades', 'Costo'],
        [SUCURSAL, 'RPT-ARO', 'Joya RPT — Aro', 'Titanio', 1, 100],
        ['Total', undefined, undefined, undefined, 1, 100],
      ]);
    });

    it('?formato=pdf: tamaño carta, horizontal cuando la tabla es ancha', async () => {
      const angosto = await descargar(jefa.acceso, `cobros?sucursal_id=${ids.suc}&formato=pdf`);
      expect(angosto.headers['content-type']).toBe('application/pdf');
      expect(angosto.headers['content-disposition']).toBe(
        `attachment; filename="cobros_${hoy}.pdf"`,
      );
      const pdf = (angosto.body as Buffer).toString('latin1');
      expect(pdf.startsWith('%PDF-')).toBe(true);
      expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(pdf).toMatch(/\/MediaBox \[0 0 612 792\]/);

      const ancho = await descargar(
        jefa.acceso,
        `ventas-por-vendedor?sucursal_id=${ids.suc}&formato=pdf`,
      );
      expect((ancho.body as Buffer).toString('latin1')).toMatch(/\/MediaBox \[0 0 792 612\]/);

      // todos los reportes salen en PDF, también los que no tienen datos
      for (const ruta of [
        'ventas',
        'ventas-por-sucursal',
        'productos',
        'perforaciones',
        'gamas',
        'promociones',
        'sobreprecios',
        'piezas-en-paquetes',
        'compras-por-proveedor',
        'compras-por-proveedor?desde=2019-03-01&hasta=2019-04-30',
        'cierres',
        'mermas',
        'inventario-valorizado',
        'por-reponer',
      ]) {
        const separador = ruta.includes('?') ? '&' : '?';
        const { body } = await descargar(jefa.acceso, `${ruta}${separador}formato=pdf`);
        expect((body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      }
      const vacio = await descargar(
        jefa.acceso,
        `sobreprecios?sucursal_id=${ids.suc}&desde=2001-01-01&hasta=2001-01-31&formato=pdf`,
      );
      expect((vacio.body as Buffer).length).toBeGreaterThan(800);
    });

    it('exportar pide el mismo permiso que ver el reporte', async () => {
      await con(vera.acceso, '/api/reportes/ventas?formato=xlsx').expect(403);
      await con(eva.acceso, '/api/reportes/inventario-valorizado?formato=pdf').expect(403);
      await con(eva.acceso, '/api/reportes/compras-por-proveedor?formato=xlsx').expect(403);
      await con(eva.acceso, '/api/reportes/piezas-en-paquetes?formato=pdf').expect(403);
      await con(rita.acceso, '/api/reportes/cierres?formato=xlsx').expect(403);
    });
  });
});
