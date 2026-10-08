import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AlertaAdmin } from '../src/alertas/alertas.service';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type {
  Denominacion,
  MetodoPago,
  MovimientoCaja,
  TicketCierre,
  TurnoActual,
  TurnoDetalle,
  TurnoResumen,
} from '../src/caja/caja.service';
import type { Existencia } from '../src/inventario/inventario.service';
import type { PerforacionCatalogo } from '../src/perforaciones/perforaciones.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import type { TipoCambioDelDia } from '../src/tipo-cambio/tipo-cambio.service';
import type { VentaDetalle, VentaResumen } from '../src/ventas/ventas.service';
import {
  comoBytes,
  cookiePuesta,
  crearApp,
  crearUsuarioDePrueba,
  tokenDeAcceso,
} from './utilidades';

// Recorrido completo de B6 (POS y caja) en una sucursal propia: se abre la caja, se vende de todas
// las formas, se anula, se cierra a ciegas con un reconteo y se revisa el historial. Las pruebas
// van en orden y comparten estado. Los montos del turno están pensados para que el cierre tenga
// un faltante de C$250 (más que la tolerancia de C$100).

type Metodo = 'get' | 'post' | 'put';

function hoyEnManagua(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date());
}

describe('POS y caja', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { jefa: 0, vera: 0, enzo: 0, suc: 0, caja: 0, lam: 0, cajaLam: 0, titanio: 0 };
  const pieza = { aro: 0, cadena: 0, paquete: 0 };
  const equipo = { pc: { id: '', token: '' }, tablet: { id: '', token: '' } };
  /** Sesiones: la jefa (admin, sin equipo), Vera (vendedora) en la PC de caja y en la tablet,
   *  Enzo (encargado) en la PC y Lola (vendedora de otra sucursal). */
  const jefa = { acceso: '' };
  const vera = { acceso: '', enTablet: '' };
  const enzo = { acceso: '' };
  const lola = { acceso: '' };
  const propio = { turno: 0, turno2: 0, promocion: 0, tipoCambioOriginal: '' };
  const venta = { a: 0, b: 0, tablet: 0, jefa: 0 };
  const claveA = randomUUID();

  function conSesion(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function comoJefa(metodo: Metodo, ruta: string) {
    return conSesion(metodo, ruta, jefa.acceso);
  }

  /** POST /api/ventas con una clave de idempotencia nueva (salvo que el cuerpo traiga la suya). */
  function vender(acceso: string, cuerpo: Record<string, unknown>) {
    return conSesion('post', '/api/ventas', acceso).send({
      clave_idempotencia: randomUUID(),
      ...cuerpo,
    });
  }

  const unAro = () => [{ variante_id: pieza.aro, cantidad: 1 }];
  const efectivo = (monto: number) => [{ metodo: 'EFECTIVO', monto }];

  async function registrarEquipo(
    nombre: string,
    tipo: 'CAJA' | 'TABLET',
    sucursalId: number,
    cajaId?: number,
  ): Promise<{ id: string; token: string }> {
    const respuesta = await comoJefa('post', '/api/equipos')
      .send({ nombre, tipo, sucursal_id: sucursalId, ...(cajaId && { caja_id: cajaId }) })
      .expect(201);
    return {
      id: respuesta.body.equipo.id,
      token: cookiePuesta(respuesta, 'esmeralda_equipo')?.valor ?? '',
    };
  }

  async function stock(varianteId: number): Promise<number | null | undefined> {
    const { body } = await comoJefa(
      'get',
      `/api/inventario/existencias?sucursal_id=${ids.suc}&buscar=POS-B6`,
    ).expect(200);
    return (body.existencias as Existencia[]).find((e) => e.variante.id === varianteId)?.cantidad;
  }

  async function ultimoNumero(): Promise<number> {
    const fila = await bd.db
      .selectFrom('sucursal')
      .select('ultimo_numero_venta')
      .where('id', '=', ids.suc)
      .executeTakeFirstOrThrow();
    return fila.ultimo_numero_venta;
  }

  beforeAll(async () => {
    app = await crearApp();
    await app.listen(0); // ya escuchando: hay pruebas que envían dos solicitudes a la vez
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const lam = await bd.db
      .selectFrom('sucursal as s')
      .innerJoin('caja as c', 'c.sucursal_id', 's.id')
      .select(['s.id', 'c.id as caja_id'])
      .where('s.codigo', '=', 'LAM')
      .executeTakeFirstOrThrow();
    ids.lam = lam.id;
    ids.cajaLam = lam.caja_id;

    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa del POS',
      username: 'jefa.pos',
      password: 'PuntoVenta#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.pos', 'PuntoVenta#2026');

    // Sucursal propia con una caja, su PC de caja y una tablet
    const sucursal = await comoJefa('post', '/api/sucursales')
      .send({
        codigo: 'PVE',
        nombre: 'Sucursal POS e2e',
        direccion: 'Plaza de pruebas',
        telefono: '2222-3333',
      })
      .expect(201);
    ids.suc = sucursal.body.sucursal.id;
    const conCaja = await comoJefa('post', `/api/sucursales/${ids.suc}/cajas`)
      .send({ nombre: 'Caja 1' })
      .expect(201);
    ids.caja = conCaja.body.sucursal.cajas[0].id;
    equipo.pc = await registrarEquipo('PC de caja POS e2e', 'CAJA', ids.suc, ids.caja);
    equipo.tablet = await registrarEquipo('Tablet POS e2e', 'TABLET', ids.suc);
    const tabletLam = await registrarEquipo('Tablet LAM del POS e2e', 'TABLET', ids.lam);

    ids.vera = await crearUsuarioDePrueba(app, {
      nombre: 'Vera Pos',
      username: 'vera.pos',
      password: 'Vendedora#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.suc],
    });
    vera.acceso = await tokenDeAcceso(app, 'vera.pos', 'Vendedora#2026', equipo.pc.token);
    vera.enTablet = await tokenDeAcceso(app, 'vera.pos', 'Vendedora#2026', equipo.tablet.token);
    ids.enzo = await crearUsuarioDePrueba(app, {
      nombre: 'Enzo Pos',
      username: 'enzo.pos',
      password: 'Encargado#2026',
      rol: 'ENCARGADO',
      sucursales: [ids.suc],
    });
    enzo.acceso = await tokenDeAcceso(app, 'enzo.pos', 'Encargado#2026', equipo.pc.token);
    await crearUsuarioDePrueba(app, {
      nombre: 'Lola Pos',
      username: 'lola.pos',
      password: 'Vendedora#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.lam],
    });
    lola.acceso = await tokenDeAcceso(app, 'lola.pos', 'Vendedora#2026', tabletLam.token);

    // Catálogo propio: un aro de titanio (sirve para paquetes), una cadena y una perforación.
    // Titanio: las otras pruebas cuentan las piezas de las gamas de acero y su tabla de precios.
    const gamas = await comoJefa('get', '/api/gamas').expect(200);
    ids.titanio =
      (gamas.body.gamas as { id: number; nombre: string }[]).find((g) => g.nombre === 'Titanio')
        ?.id ?? 0;
    const categoria = await comoJefa('post', '/api/categorias')
      .send({ nombre: 'Joyas B6' })
      .expect(201);
    const producto = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: categoria.body.categoria.id,
        nombre: 'Joya B6',
        variantes: [
          { sku: 'POS-B6-ARO', nombre: 'Aro', precio_venta: 250, gama_id: ids.titanio },
          { sku: 'POS-B6-CAD', nombre: 'Cadena', precio_venta: 1200 },
        ],
      })
      .expect(201);
    const variantes = (producto.body.producto as ProductoCatalogo).variantes;
    pieza.aro = variantes.find((v) => v.sku === 'POS-B6-ARO')?.id ?? 0;
    pieza.cadena = variantes.find((v) => v.sku === 'POS-B6-CAD')?.id ?? 0;
    for (const [variante, cantidad] of [
      [pieza.aro, 20],
      [pieza.cadena, 5],
    ]) {
      await comoJefa('post', '/api/inventario/movimientos')
        .send({
          sucursal_id: ids.suc,
          variante_id: variante,
          tipo: 'AJUSTE_POSITIVO',
          cantidad,
          motivo: 'Existencias para las pruebas del POS',
        })
        .expect(201);
    }
    const perforacion = await comoJefa('post', '/api/perforaciones')
      .send({ codigo: 'PVB', nombre: 'Lóbulo B6', precio_servicio: 200 })
      .expect(201);
    pieza.paquete = (perforacion.body.perforacion as PerforacionCatalogo).paquete_variante_id;

    const tipoCambio = await comoJefa('get', '/api/tipo-cambio').expect(200);
    propio.tipoCambioOriginal = tipoCambio.body.tipo_cambio.usd_a_nio;
  });

  afterAll(async () => {
    // Las otras pruebas esperan el tipo de cambio de los datos demo
    await comoJefa('put', '/api/tipo-cambio').send({
      usd_a_nio: propio.tipoCambioOriginal,
      confirmar: true,
    });
    await app.close();
  });

  it('sin sesión → 401 en las rutas del POS y de la caja', async () => {
    const rutas: [Metodo, string][] = [
      ['get', '/api/caja/turno'],
      ['post', '/api/caja/turno/abrir'],
      ['get', '/api/caja/turno/movimientos'],
      ['post', '/api/caja/turno/movimientos'],
      ['post', '/api/caja/turno/cerrar'],
      ['get', '/api/turnos'],
      ['get', '/api/turnos/1'],
      ['get', '/api/turnos/1/ticket'],
      ['post', '/api/turnos/1/cierre-forzado'],
      ['post', '/api/turnos/1/imprimir'],
      ['get', '/api/ventas'],
      ['get', '/api/ventas/1'],
      ['post', '/api/ventas'],
      ['post', '/api/ventas/1/anular'],
      ['post', '/api/ventas/1/imprimir'],
      ['get', '/api/tipo-cambio'],
      ['put', '/api/tipo-cambio'],
      ['get', '/api/tipo-cambio/historial'],
      ['get', '/api/metodos-pago'],
      ['get', '/api/denominaciones'],
    ];
    for (const [metodo, ruta] of rutas) await request(http)[metodo](ruta).expect(401);
  });

  describe('datos para las pantallas de cobro y de conteo', () => {
    it('GET /api/metodos-pago y /api/denominaciones: los ve cualquier usuario con sesión', async () => {
      const metodos = await conSesion('get', '/api/metodos-pago', vera.acceso).expect(200);
      expect(metodos.body.metodos_pago as MetodoPago[]).toEqual([
        { codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true, requiere_referencia: false },
        { codigo: 'TARJETA', nombre: 'Tarjeta', es_efectivo: false, requiere_referencia: true },
        {
          codigo: 'TRANSFERENCIA',
          nombre: 'Transferencia',
          es_efectivo: false,
          requiere_referencia: true,
        },
      ]);
      const { body } = await conSesion('get', '/api/denominaciones', vera.acceso).expect(200);
      const denominaciones = body.denominaciones as Denominacion[];
      expect(denominaciones).toHaveLength(27);
      expect(denominaciones[0]).toEqual({ moneda: 'NIO', valor: '1000.00', tipo: 'BILLETE' });
      expect(denominaciones.filter((d) => d.moneda === 'USD')[0]).toEqual({
        moneda: 'USD',
        valor: '100.00',
        tipo: 'BILLETE',
      });
    });
  });

  describe('tipo de cambio', () => {
    it('GET /api/tipo-cambio: el vigente, aunque sea de un día anterior', async () => {
      const { body } = await conSesion('get', '/api/tipo-cambio', vera.acceso).expect(200);
      expect(body.tipo_cambio).toMatchObject({
        usd_a_nio: propio.tipoCambioOriginal,
        fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
    });

    it('PUT /api/tipo-cambio registra el de hoy y lo deja corregir el mismo día', async () => {
      const { body } = await conSesion('put', '/api/tipo-cambio', enzo.acceso)
        .send({ usd_a_nio: 36.9 })
        .expect(200);
      expect(body.tipo_cambio).toEqual({
        fecha: hoyEnManagua(),
        usd_a_nio: '36.9000',
        es_de_hoy: true,
        registrado_por: { id: ids.enzo, nombre_completo: 'Enzo Pos' },
      });
      const corregido = await comoJefa('put', '/api/tipo-cambio')
        .send({ usd_a_nio: '36.80' })
        .expect(200);
      expect(corregido.body.tipo_cambio).toMatchObject({
        fecha: hoyEnManagua(),
        usd_a_nio: '36.8000',
        registrado_por: { id: ids.jefa },
      });
      const filas = await bd.db
        .selectFrom('tipo_cambio')
        .select('usd_a_nio')
        .where('fecha', '=', hoyEnManagua())
        .execute();
      expect(filas).toEqual([{ usd_a_nio: '36.8000' }]);
    });

    it('GET /api/tipo-cambio/historial: un día por fila, con quién lo dejó y lo que se registró ese día', async () => {
      const hoy = hoyEnManagua();
      const ruta = '/api/tipo-cambio/historial';
      const { body } = await conSesion('get', ruta, enzo.acceso).expect(200);
      const historial = body.historial as TipoCambioDelDia[];
      const enzoPos = { id: ids.enzo, nombre_completo: 'Enzo Pos' };
      const jefaPos = { id: ids.jefa, nombre_completo: 'Jefa del POS' };
      // Del más reciente al más antiguo: el de hoy y, detrás, el de los datos demo
      expect(historial).toHaveLength(2);
      expect(historial[0]).toEqual({
        fecha: hoy,
        usd_a_nio: '36.8000',
        registrado_por: jefaPos,
        registrado_at: expect.any(String),
        // la tabla guarda el último valor del día; la corrección se ve aquí
        registros: [
          { usd_a_nio: '36.9000', registrado_por: enzoPos, registrado_at: expect.any(String) },
          { usd_a_nio: '36.8000', registrado_por: jefaPos, registrado_at: expect.any(String) },
        ],
      });
      const [primero, ultimo] = historial[0].registros.map((r) => String(r.registrado_at));
      expect(historial[0].registrado_at).toBe(ultimo);
      expect(Date.parse(primero)).toBeLessThanOrEqual(Date.parse(ultimo));
      // el de los datos demo lo registró el administrador, una sola vez
      const admin = { id: expect.any(Number), nombre_completo: expect.any(String) };
      expect(historial[1]).toMatchObject({
        usd_a_nio: propio.tipoCambioOriginal,
        registrado_por: admin,
        registros: [{ usd_a_nio: propio.tipoCambioOriginal, registrado_por: admin }],
      });
      expect(historial[1].registros).toHaveLength(1);
      expect(historial[1].fecha < hoy).toBe(true);

      const fechas = async (consulta: string) => {
        const respuesta = await comoJefa('get', `${ruta}?${consulta}`).expect(200);
        return (respuesta.body.historial as TipoCambioDelDia[]).map((d) => d.fecha);
      };
      expect(await fechas(`desde=${hoy}`)).toEqual([hoy]);
      expect(await fechas(`hasta=${historial[1].fecha}`)).toEqual([historial[1].fecha]);
      expect(await fechas(`desde=${historial[1].fecha}&hasta=${hoy}`)).toEqual([
        hoy,
        historial[1].fecha,
      ]);
      expect(await fechas('limite=1')).toEqual([hoy]);
      expect(await fechas('desde=2001-01-01&hasta=2001-12-31')).toEqual([]);

      const invalidas: [string, string, string][] = [
        ['desde=ayer', 'desde', 'desde debe ser una fecha con el formato AAAA-MM-DD'],
        [`desde=${hoy}&hasta=2001-01-01`, 'hasta', 'hasta no puede ser anterior a desde'],
        ['limite=0', 'limite', 'limite debe ser un número entre 1 y 200'],
      ];
      for (const [consulta, campo, mensaje] of invalidas) {
        const invalida = await comoJefa('get', `${ruta}?${consulta}`).expect(400);
        expect(invalida.body.errores).toEqual([{ campo, mensaje }]);
      }
    });

    it('valores inválidos → 400; sin TIPO_CAMBIO_GESTIONAR → 403', async () => {
      for (const usd_a_nio of [0, -1, 'treinta', 36.12345, null]) {
        const { body } = await comoJefa('put', '/api/tipo-cambio').send({ usd_a_nio }).expect(400);
        expect(body.errores).toEqual([
          {
            campo: 'usd_a_nio',
            mensaje: 'usd_a_nio debe ser un monto mayor que 0, con 4 decimales como máximo',
          },
        ]);
      }
      await conSesion('put', '/api/tipo-cambio', vera.acceso)
        .send({ usd_a_nio: 40 })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere TIPO_CAMBIO_GESTIONAR',
        });
    });

    it('si se aleja más de 5 % del último registrado → 409, salvo con confirmación explícita', async () => {
      // un error de dedo: 368 en vez de 36.8
      await conSesion('put', '/api/tipo-cambio', enzo.acceso)
        .send({ usd_a_nio: 368 })
        .expect(409)
        .expect({
          codigo: 'CONFIRMACION_REQUERIDA',
          mensaje:
            'El tipo de cambio 368.0000 se aleja más de 5 % del último registrado (36.8000). Si es correcto, confírmelo.',
        });
      const haciaAbajo = await comoJefa('put', '/api/tipo-cambio')
        .send({ usd_a_nio: 3.68, confirmar: false })
        .expect(409);
      expect(haciaAbajo.body.codigo).toBe('CONFIRMACION_REQUERIDA');
      const sinCambio = await conSesion('get', '/api/tipo-cambio', vera.acceso).expect(200);
      expect(sinCambio.body.tipo_cambio.usd_a_nio).toBe('36.8000');

      // la confirmación es un true explícito
      const malConfirmado = await comoJefa('put', '/api/tipo-cambio')
        .send({ usd_a_nio: 40, confirmar: 'si' })
        .expect(400);
      expect(malConfirmado.body.errores).toEqual([
        { campo: 'confirmar', mensaje: 'confirmar debe ser true o false' },
      ]);
      const confirmado = await conSesion('put', '/api/tipo-cambio', enzo.acceso)
        .send({ usd_a_nio: 40, confirmar: true })
        .expect(200);
      expect(confirmado.body.tipo_cambio).toMatchObject({
        usd_a_nio: '40.0000',
        registrado_por: { id: ids.enzo },
      });
      // quien confirma un valor fuera del límite deja una alerta para el administrador
      const alertas = await comoJefa(
        'get',
        '/api/alertas?tipo=TIPO_CAMBIO_FUERA_LIMITE&limite=1',
      ).expect(200);
      expect((alertas.body.alertas as AlertaAdmin[])[0]).toMatchObject({
        titulo:
          'Tipo de cambio 40.0000 confirmado por Enzo Pos: se aleja más de 5 % del anterior (36.8000)',
        detalle: {
          usd_a_nio: 40,
          anterior: 36.8,
          variacion_pct: 8.7,
          maximo_pct: 5,
          usuario_id: ids.enzo,
        },
        sucursal: null,
      });

      // volver al valor correcto también se compara con el último (40 → 36.8 es −8 %)
      await comoJefa('put', '/api/tipo-cambio').send({ usd_a_nio: '36.80' }).expect(409);
      const corregido = await comoJefa('put', '/api/tipo-cambio')
        .send({ usd_a_nio: '36.80', confirmar: true })
        .expect(200);
      expect(corregido.body.tipo_cambio.usd_a_nio).toBe('36.8000');
    });

    it('el límite es el parámetro TIPO_CAMBIO_VARIACION_MAX, que se cambia desde el panel', async () => {
      const fijarLimite = (valor: string) =>
        comoJefa('put', '/api/parametros/TIPO_CAMBIO_VARIACION_MAX').send({ valor }).expect(200);
      await conSesion('put', '/api/tipo-cambio', enzo.acceso).send({ usd_a_nio: 39 }).expect(409);
      await fijarLimite('10');
      try {
        const { body } = await conSesion('put', '/api/tipo-cambio', enzo.acceso)
          .send({ usd_a_nio: 39 }) // +5.98 %
          .expect(200);
        expect(body.tipo_cambio.usd_a_nio).toBe('39.0000');
        await conSesion('put', '/api/tipo-cambio', enzo.acceso).send({ usd_a_nio: 43 }).expect(409);
      } finally {
        await fijarLimite('5');
        await comoJefa('put', '/api/tipo-cambio')
          .send({ usd_a_nio: '36.80', confirmar: true })
          .expect(200);
      }
    });

    it('sin un tipo de cambio anterior solo se aceptan valores entre 20 y 60', async () => {
      // Se quitan los registrados solo mientras dura esta prueba (los archivos corren uno tras otro)
      const registrados = await bd.db.selectFrom('tipo_cambio').selectAll().execute();
      await bd.db.deleteFrom('tipo_cambio').execute();
      try {
        await conSesion('get', '/api/tipo-cambio', vera.acceso)
          .expect(200)
          .expect({ tipo_cambio: null });
        // fuera del rango no entra, ni con la confirmación
        for (const [usd_a_nio, recibido] of [
          [19.99, '19.9900'],
          [60.01, '60.0100'],
          [366.24, '366.2400'],
        ]) {
          await comoJefa('put', '/api/tipo-cambio')
            .send({ usd_a_nio, confirmar: true })
            .expect(422)
            .expect({
              codigo: 'REGLA_NEGOCIO',
              mensaje: `Es el primer tipo de cambio que se registra: debe estar entre 20 y 60 córdobas por dólar (recibido: ${recibido})`,
            });
        }
        await conSesion('get', '/api/tipo-cambio', vera.acceso)
          .expect(200)
          .expect({ tipo_cambio: null });
        const { body } = await conSesion('put', '/api/tipo-cambio', enzo.acceso)
          .send({ usd_a_nio: 36.5 })
          .expect(200);
        expect(body.tipo_cambio).toMatchObject({ usd_a_nio: '36.5000', es_de_hoy: true });
      } finally {
        await bd.db.deleteFrom('tipo_cambio').execute();
        await bd.db.insertInto('tipo_cambio').values(registrados).execute();
      }
      const repuesto = await conSesion('get', '/api/tipo-cambio', vera.acceso).expect(200);
      expect(repuesto.body.tipo_cambio).toMatchObject({ usd_a_nio: '36.8000', es_de_hoy: true });
    });
  });

  describe('apertura: la caja sale del equipo registrado', () => {
    it('con la caja cerrada no hay turno y no se puede vender', async () => {
      await conSesion('get', '/api/caja/turno', vera.acceso).expect(200).expect({ turno: null });
      await vender(vera.acceso, { items: unAro(), pagos: efectivo(250) })
        .expect(409)
        .expect({
          codigo: 'SIN_TURNO_ABIERTO',
          mensaje: 'La caja no tiene un turno abierto: ábrala primero',
        });
    });

    it('la vendedora no puede elegir la caja: manda su equipo', async () => {
      await conSesion('post', '/api/caja/turno/abrir', vera.enTablet)
        .send({ inicial_nio: 1000, caja_id: ids.cajaLam })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Solo el administrador puede elegir la caja',
        });
      await conSesion('post', '/api/caja/turno/abrir', vera.acceso)
        .send({ inicial_nio: 1000, caja_id: ids.cajaLam })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Este equipo trabaja con su propia caja: no se puede elegir otra',
        });
      // ni siquiera el administrador, cuando está sentado en una PC de caja
      const jefaEnPc = await tokenDeAcceso(app, 'jefa.pos', 'PuntoVenta#2026', equipo.pc.token);
      await conSesion('get', `/api/caja/turno?caja_id=${ids.cajaLam}`, jefaEnPc).expect(422);
    });

    it('POST /api/caja/turno/abrir abre la caja del equipo y no devuelve montos', async () => {
      const { body } = await conSesion('post', '/api/caja/turno/abrir', vera.acceso)
        .send({ inicial_nio: 1000, inicial_usd: '20' })
        .expect(201);
      expect(body.turno as TurnoActual).toEqual({
        id: expect.any(Number),
        sucursal: { id: ids.suc, codigo: 'PVE', nombre: 'Sucursal POS e2e' },
        caja: { id: ids.caja, nombre: 'Caja 1' },
        abierto_por: { id: ids.vera, nombre_completo: 'Vera Pos' },
        fecha_apertura: expect.any(String),
        cierre_pide_justificacion: false,
      });
      propio.turno = body.turno.id;

      // el mismo turno desde la PC, desde la tablet de la sucursal y para el encargado
      for (const acceso of [vera.acceso, vera.enTablet, enzo.acceso]) {
        const actual = await conSesion('get', '/api/caja/turno', acceso).expect(200);
        expect(actual.body.turno.id).toBe(propio.turno);
      }
    });

    it('una caja abierta no se vuelve a abrir; montos inválidos → 400', async () => {
      await conSesion('post', '/api/caja/turno/abrir', vera.acceso)
        .send({ inicial_nio: 500 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La caja ${ids.caja} ya tiene un turno abierto: ciérrelo antes de abrir otro`,
        });
      const invalido = await conSesion('post', '/api/caja/turno/abrir', vera.acceso)
        .send({ inicial_nio: -5, inicial_usd: 'veinte', caja_id: 'uno' })
        .expect(400);
      expect(invalido.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'inicial_nio',
        'inicial_usd',
        'caja_id',
      ]);
    });

    it('el administrador sin equipo registrado tiene que indicar la caja', async () => {
      await comoJefa('get', '/api/caja/turno').expect(400).expect({
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Indique la caja (caja_id): esta sesión no es de un equipo registrado',
      });
      const { body } = await comoJefa('get', `/api/caja/turno?caja_id=${ids.caja}`).expect(200);
      expect(body.turno.id).toBe(propio.turno);
      await comoJefa('get', '/api/caja/turno?caja_id=999999')
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La caja 999999 no existe' });
    });
  });

  describe('ventas', () => {
    it('POST /api/ventas: efectivo con vuelto; la respuesta es el ticket', async () => {
      const { body } = await vender(vera.acceso, {
        clave_idempotencia: claveA,
        items: [{ variante_id: pieza.cadena, cantidad: 1 }],
        pagos: [{ metodo: 'efectivo', monto: 1500 }],
        cliente_nombre: ' Ana Cliente ',
        cliente_telefono: '8888-0000',
      }).expect(201);
      expect(body.repetida).toBe(false);
      expect(body.venta as VentaDetalle).toEqual({
        id: expect.any(Number),
        numero: 'PVE-00000001',
        fecha: expect.any(String),
        estado: 'COMPLETADA',
        sucursal: { id: ids.suc, codigo: 'PVE', nombre: 'Sucursal POS e2e' },
        turno_id: propio.turno,
        vendedor: { id: ids.vera, nombre_completo: 'Vera Pos' },
        cliente_nombre: 'Ana Cliente',
        subtotal: '1200.00',
        descuento: '0.00',
        total: '1200.00',
        articulos: 1,
        caja: { id: ids.caja, nombre: 'Caja 1' },
        cliente_telefono: '8888-0000',
        notas: null,
        tipo_cambio: '36.8000',
        promocion: null,
        lineas: [
          {
            id: expect.any(Number),
            variante: { id: pieza.cadena, sku: 'POS-B6-CAD', nombre: 'Joya B6 — Cadena' },
            tipo: 'PRODUCTO',
            cantidad: 1,
            precio_lista: '1200.00',
            precio_unitario: '1200.00',
            subtotal: '1200.00',
            piezas: [],
          },
        ],
        pagos: [
          {
            metodo: { codigo: 'EFECTIVO', nombre: 'Efectivo' },
            moneda: 'NIO',
            monto: '1500.00',
            tipo_cambio: '1.0000',
            monto_nio: '1500.00',
            referencia: null,
          },
        ],
        vuelto: '300.00',
        anulacion: null,
        ticket: {
          negocio: 'Esmeralda Experience',
          ruc: null,
          direccion: 'Plaza de pruebas',
          telefono: '2222-3333',
          leyenda: null,
        },
      });
      venta.a = body.venta.id;
      expect(await stock(pieza.cadena)).toBe(4);
    });

    it('pago mixto: dólares en efectivo al tipo de cambio de hoy y el resto con tarjeta', async () => {
      const { body } = await vender(vera.acceso, {
        items: [{ variante_id: pieza.aro, cantidad: 2 }],
        pagos: [
          { metodo: 'EFECTIVO', moneda: 'usd', monto: 10 },
          { metodo: 'TARJETA', monto: '132.00', referencia: ' 4455 ' },
        ],
      }).expect(201);
      const mixta = body.venta as VentaDetalle;
      expect(mixta).toMatchObject({ numero: 'PVE-00000002', total: '500.00', vuelto: '0.00' });
      expect(mixta.pagos).toEqual([
        {
          metodo: { codigo: 'EFECTIVO', nombre: 'Efectivo' },
          moneda: 'USD',
          monto: '10.00',
          tipo_cambio: '36.8000',
          monto_nio: '368.00',
          referencia: null,
        },
        {
          metodo: { codigo: 'TARJETA', nombre: 'Tarjeta' },
          moneda: 'NIO',
          monto: '132.00',
          tipo_cambio: '1.0000',
          monto_nio: '132.00',
          referencia: '4455',
        },
      ]);
      venta.b = mixta.id;
    });

    it('el precio se puede subir (hasta el tope), nunca bajar', async () => {
      const { body } = await vender(vera.acceso, {
        items: [{ variante_id: pieza.aro, cantidad: 1, precio: 300 }],
        pagos: efectivo(300),
      }).expect(201);
      expect((body.venta as VentaDetalle).lineas[0]).toMatchObject({
        precio_lista: '250.00',
        precio_unitario: '300.00',
      });

      const rebajado = await vender(vera.acceso, {
        items: [{ variante_id: pieza.aro, cantidad: 1, precio: 200 }],
        pagos: efectivo(200),
      }).expect(422);
      expect(rebajado.body).toEqual({
        codigo: 'REGLA_NEGOCIO',
        mensaje:
          'El precio de venta no puede ser menor al establecido: "Joya B6 — Aro" C$ 200.00 (establecido C$ 250.00)',
      });
      const excesivo = await vender(vera.acceso, {
        items: [{ variante_id: pieza.aro, cantidad: 1, precio: 400 }],
        pagos: efectivo(400),
      }).expect(422);
      expect(excesivo.body.mensaje).toMatch(/^El precio supera el aumento máximo permitido/);
    });

    it('paquete: perforación con la pieza escaneada (titanio: servicio C$200 + pieza C$250)', async () => {
      const { body } = await vender(vera.acceso, {
        items: [{ variante_id: pieza.paquete, cantidad: 1, piezas: [pieza.aro] }],
        pagos: efectivo(450),
      }).expect(201);
      const paquete = body.venta as VentaDetalle;
      expect(paquete).toMatchObject({ numero: 'PVE-00000004', total: '450.00', articulos: 1 });
      expect(paquete.lineas).toEqual([
        {
          id: expect.any(Number),
          variante: {
            id: pieza.paquete,
            sku: 'PAQ-PVB',
            nombre: expect.stringContaining('Lóbulo B6'),
          },
          tipo: 'PAQUETE',
          cantidad: 1,
          precio_lista: '450.00',
          precio_unitario: '450.00',
          subtotal: '450.00',
          piezas: [
            {
              variante: { id: pieza.aro, sku: 'POS-B6-ARO', nombre: 'Joya B6 — Aro' },
              cantidad: 1,
            },
          ],
        },
      ]);
      // 20 − 2 (mixta) − 1 (precio subido) − 1 (la pieza del paquete)
      expect(await stock(pieza.aro)).toBe(16);
    });

    it('la promoción es la única rebaja, y se paga por transferencia con su referencia', async () => {
      const creada = await comoJefa('post', '/api/promociones')
        .send({ nombre: 'Promo B6', tipo: 'PORCENTAJE', valor: 10 })
        .expect(201);
      propio.promocion = creada.body.promocion.id;
      await comoJefa('put', `/api/promociones/${propio.promocion}/activa`)
        .send({ activa: true })
        .expect(200);

      const { body } = await vender(vera.acceso, {
        items: [{ variante_id: pieza.cadena, cantidad: 1 }],
        pagos: [{ metodo: 'TRANSFERENCIA', monto: 1080, referencia: 'BAC-1' }],
        promocion_id: propio.promocion,
        notas: 'Clienta frecuente',
      }).expect(201);
      expect(body.venta as VentaDetalle).toMatchObject({
        numero: 'PVE-00000005',
        subtotal: '1200.00',
        descuento: '120.00',
        total: '1080.00',
        promocion: { id: propio.promocion, nombre: 'Promo B6' },
        notas: 'Clienta frecuente',
      });
      await comoJefa('put', `/api/promociones/${propio.promocion}/activa`)
        .send({ activa: false })
        .expect(200);
    });

    it('las ventas rechazadas dicen por qué y no consumen número de factura', async () => {
      const antes = await ultimoNumero();
      const casos: [Record<string, unknown>, string | RegExp][] = [
        [
          { items: [{ variante_id: pieza.cadena, cantidad: 9 }], pagos: efectivo(10800) },
          /^Stock insuficiente/,
        ],
        [
          { items: unAro(), pagos: efectivo(100) },
          'Pago insuficiente: total C$ 250.00, pagado C$ 100.00',
        ],
        [
          { items: unAro(), pagos: [{ metodo: 'TARJETA', monto: 250 }] },
          'El pago con TARJETA requiere número de referencia',
        ],
        [
          { items: unAro(), pagos: [{ metodo: 'CHEQUE', monto: 250 }] },
          'Método de pago inválido: CHEQUE',
        ],
        [
          { items: unAro(), pagos: efectivo(250), promocion_id: propio.promocion },
          'La promoción "Promo B6" no está activa',
        ],
        [
          { items: [{ variante_id: 999999, cantidad: 1 }], pagos: efectivo(1) },
          'Variante inexistente: 999999',
        ],
      ];
      for (const [cuerpo, mensaje] of casos) {
        const { body } = await vender(vera.acceso, cuerpo).expect(422);
        expect(body.codigo).toBe('REGLA_NEGOCIO');
        expect(body.mensaje).toEqual(
          typeof mensaje === 'string' ? mensaje : expect.stringMatching(mensaje),
        );
      }
      expect(await ultimoNumero()).toBe(antes);
    });

    it('datos mal armados → 400 con el campo que falla', async () => {
      const { body } = await conSesion('post', '/api/ventas', vera.acceso)
        .send({
          items: [{ variante_id: pieza.aro, cantidad: 0, piezas: [] }],
          pagos: [{ metodo: 'efectivo!', moneda: 'EUR', monto: 0 }],
        })
        .expect(400);
      expect(body.codigo).toBe('DATOS_INVALIDOS');
      expect(body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'clave_idempotencia',
        'items.0.cantidad',
        'items.0.piezas',
        'pagos.0.metodo',
        'pagos.0.moneda',
        'pagos.0.monto',
      ]);
      const vacia = await vender(vera.acceso, { items: [], pagos: [] }).expect(400);
      expect(vacia.body.errores.map((e: { mensaje: string }) => e.mensaje)).toEqual([
        'La venta debe tener al menos un producto',
        'La venta debe tener al menos un pago',
      ]);
    });

    describe('clave de idempotencia', () => {
      it('reintentar con la misma clave devuelve la misma venta (200), sin crear otra', async () => {
        const antes = await ultimoNumero();
        const { body } = await vender(vera.acceso, {
          clave_idempotencia: claveA,
          items: [{ variante_id: pieza.cadena, cantidad: 1 }],
          pagos: efectivo(1500),
        }).expect(200);
        expect(body.repetida).toBe(true);
        expect(body.venta).toMatchObject({ id: venta.a, numero: 'PVE-00000001' });
        expect(await ultimoNumero()).toBe(antes);
        expect(await stock(pieza.cadena)).toBe(3); // la A y la de la promoción: no bajó otra vez
      });

      it('dos solicitudes simultáneas con la misma clave crean una sola venta', async () => {
        const antes = await ultimoNumero();
        const cuerpo = { clave_idempotencia: randomUUID(), items: unAro(), pagos: efectivo(250) };
        const [una, otra] = await Promise.all([
          vender(vera.acceso, cuerpo),
          vender(vera.acceso, cuerpo),
        ]);
        expect([200, 201]).toContain(una.status);
        expect([200, 201]).toContain(otra.status);
        expect(una.body.venta.id).toBe(otra.body.venta.id);
        expect(una.body.venta.numero).toBe('PVE-00000006');
        expect(await ultimoNumero()).toBe(antes + 1); // un solo número de factura, sin salto
        expect(await stock(pieza.aro)).toBe(15);
      });

      it('la clave de la venta de otra persona → 409, sin mostrar esa venta', async () => {
        await vender(enzo.acceso, {
          clave_idempotencia: claveA,
          items: unAro(),
          pagos: efectivo(250),
        })
          .expect(409)
          .expect({
            codigo: 'CLAVE_REUTILIZADA',
            mensaje: 'Esa clave ya se usó en otra venta: el POS debe generar una clave nueva',
          });
        expect(await stock(pieza.aro)).toBe(15);
      });
    });

    it('desde la tablet la venta entra al turno de la sucursal; lo que mande la pantalla no cuenta', async () => {
      const { body } = await vender(vera.enTablet, {
        items: unAro(),
        pagos: efectivo(250),
        // campos que no existen en la venta: se ignoran
        sucursal_id: ids.lam,
        turno_id: 999999,
        vendedor_id: ids.jefa,
      }).expect(201);
      expect(body.venta as VentaDetalle).toMatchObject({
        numero: 'PVE-00000007',
        sucursal: { id: ids.suc },
        caja: { id: ids.caja },
        turno_id: propio.turno,
        vendedor: { id: ids.vera },
      });
      venta.tablet = body.venta.id;
      await vender(vera.enTablet, { items: unAro(), pagos: efectivo(250), caja_id: ids.cajaLam })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Solo el administrador puede elegir la caja',
        });
    });

    it('el administrador sin equipo registrado vende indicando la caja', async () => {
      await vender(jefa.acceso, { items: unAro(), pagos: efectivo(250) })
        .expect(400)
        .expect({
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'Indique la caja (caja_id): esta sesión no es de un equipo registrado',
        });
      const { body } = await vender(jefa.acceso, {
        items: unAro(),
        pagos: efectivo(250),
        caja_id: ids.caja,
      }).expect(201);
      expect(body.venta as VentaDetalle).toMatchObject({
        numero: 'PVE-00000008',
        turno_id: propio.turno,
        vendedor: { id: ids.jefa, nombre_completo: 'Jefa del POS' },
      });
      venta.jefa = body.venta.id;
    });
  });

  describe('consultar ventas', () => {
    it('GET /api/ventas: la vendedora ve las suyas; el encargado, todas las de su sucursal', async () => {
      const deVera = await conSesion('get', '/api/ventas', vera.acceso).expect(200);
      const suyas = deVera.body.ventas as VentaResumen[];
      expect(suyas.map((v) => v.numero)).toEqual(
        [7, 6, 5, 4, 3, 2, 1].map((n) => `PVE-0000000${n}`),
      );
      expect(suyas.at(-1)).toEqual({
        id: venta.a,
        numero: 'PVE-00000001',
        fecha: expect.any(String),
        estado: 'COMPLETADA',
        sucursal: { id: ids.suc, codigo: 'PVE', nombre: 'Sucursal POS e2e' },
        turno_id: propio.turno,
        vendedor: { id: ids.vera, nombre_completo: 'Vera Pos' },
        cliente_nombre: 'Ana Cliente',
        subtotal: '1200.00',
        descuento: '0.00',
        total: '1200.00',
        articulos: 1,
      });

      const deEnzo = await conSesion(
        'get',
        `/api/ventas?sucursal_id=${ids.suc}`,
        enzo.acceso,
      ).expect(200);
      expect((deEnzo.body.ventas as VentaResumen[]).map((v) => v.id)).toContain(venta.jefa);
      expect(deEnzo.body.ventas).toHaveLength(8);
    });

    it('filtros y paginación', async () => {
      const lista = async (consulta: string): Promise<string[]> =>
        (
          (await comoJefa('get', `/api/ventas?sucursal_id=${ids.suc}${consulta}`).expect(200)).body
            .ventas as VentaResumen[]
        ).map((v) => v.numero);
      expect(await lista('&buscar=ana%20cli')).toEqual(['PVE-00000001']);
      expect(await lista('&buscar=0000002')).toEqual(['PVE-00000002']);
      expect(await lista(`&vendedor_id=${ids.jefa}`)).toEqual(['PVE-00000008']);
      expect(await lista(`&turno_id=${propio.turno}&limite=2`)).toEqual([
        'PVE-00000008',
        'PVE-00000007',
      ]);
      expect(await lista(`&limite=2&antes_de=${venta.b}`)).toEqual(['PVE-00000001']);
      expect(await lista(`&desde=${hoyEnManagua()}&hasta=${hoyEnManagua()}`)).toHaveLength(8);
      expect(await lista('&hasta=2020-01-01')).toEqual([]);
      expect(await lista('&estado=anulada')).toEqual([]);
      const invalido = await comoJefa('get', '/api/ventas?estado=borrada&desde=ayer').expect(400);
      expect(invalido.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'estado',
        'desde',
      ]);
    });

    it('una venta ajena responde 404', async () => {
      const noExiste = (id: number) => ({
        codigo: 'NO_ENCONTRADO',
        mensaje: `La venta ${id} no existe`,
      });
      // Vera no ve la venta que hizo la jefa en su misma caja
      await conSesion('get', `/api/ventas/${venta.jefa}`, vera.acceso)
        .expect(404)
        .expect(noExiste(venta.jefa));
      // Lola es de otra sucursal
      await conSesion('get', `/api/ventas/${venta.a}`, lola.acceso)
        .expect(404)
        .expect(noExiste(venta.a));
      await conSesion('get', '/api/ventas', lola.acceso).expect(200).expect({ ventas: [] });
      await comoJefa('get', '/api/ventas/999999').expect(404).expect(noExiste(999999));
      const propia = await conSesion('get', `/api/ventas/${venta.a}`, vera.acceso).expect(200);
      expect(propia.body.venta.numero).toBe('PVE-00000001');
    });

    it('POST /api/ventas/:id/imprimir: el ticket en PDF de 80 mm; la primera vez el original y después copia', async () => {
      const imprimir = (acceso: string, id: number) =>
        conSesion('post', `/api/ventas/${id}/imprimir`, acceso).buffer(true).parse(comoBytes);

      const original = await imprimir(vera.acceso, venta.a).expect(200);
      expect(original.headers['content-type']).toBe('application/pdf');
      expect(original.headers['content-disposition']).toBe(
        'inline; filename="ticket-PVE-00000001.pdf"',
      );
      expect(original.headers['x-ticket-impresion']).toBe('1');
      const pdf = (original.body as Buffer).toString('latin1');
      expect(pdf.startsWith('%PDF-')).toBe(true);
      // una sola página de 80 mm (226.77 puntos) de ancho
      expect(pdf).toMatch(/\/MediaBox \[0 0 226\.77\d* \d+(\.\d+)?\]/);
      expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);

      // desde la segunda impresión es copia, la pida quien la pida
      const copia = await imprimir(enzo.acceso, venta.a).expect(200);
      expect(copia.headers['x-ticket-impresion']).toBe('2');
      expect((await imprimir(jefa.acceso, venta.a).expect(200)).headers['x-ticket-impresion']).toBe(
        '3',
      );
      // cada venta lleva su cuenta
      expect((await imprimir(vera.acceso, venta.b).expect(200)).headers['x-ticket-impresion']).toBe(
        '1',
      );

      // quien no puede ver la venta no la imprime, y su intento no cuenta
      await conSesion('post', `/api/ventas/${venta.a}/imprimir`, lola.acceso)
        .expect(404)
        .expect({ codigo: 'NO_ENCONTRADO', mensaje: `La venta ${venta.a} no existe` });
      await conSesion('post', `/api/ventas/${venta.jefa}/imprimir`, vera.acceso).expect(404);
      await comoJefa('post', '/api/ventas/abc/imprimir').expect(400);
      const impresiones = await bd.db
        .selectFrom('ticket_impresion')
        .select(['usuario_id'])
        .where('venta_id', '=', venta.a)
        .orderBy('id')
        .execute();
      expect(impresiones.map((i) => i.usuario_id)).toEqual([ids.vera, ids.enzo, ids.jefa]);
    });
  });

  describe('anular una venta', () => {
    it('POST /api/ventas/:id/anular la anula y devuelve la pieza al inventario', async () => {
      expect(await stock(pieza.aro)).toBe(13);
      const { body } = await conSesion('post', `/api/ventas/${venta.tablet}/anular`, enzo.acceso)
        .send({ motivo: ' La clienta se arrepintió ' })
        .expect(200);
      expect(body.venta as VentaDetalle).toMatchObject({
        id: venta.tablet,
        numero: 'PVE-00000007', // conserva su número
        estado: 'ANULADA',
        anulacion: {
          fecha: expect.any(String),
          motivo: 'La clienta se arrepintió',
          anulada_por: { id: ids.enzo, nombre_completo: 'Enzo Pos' },
        },
      });
      expect(await stock(pieza.aro)).toBe(14);
    });

    it('no se anula dos veces, ni sin motivo, ni una venta que no se puede ver', async () => {
      await conSesion('post', `/api/ventas/${venta.tablet}/anular`, enzo.acceso)
        .send({ motivo: 'Otra vez' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La venta PVE-00000007 ya está anulada' });
      const sinMotivo = await conSesion('post', `/api/ventas/${venta.a}/anular`, enzo.acceso)
        .send({ motivo: 'no' })
        .expect(400);
      expect(sinMotivo.body.mensaje).toBe('El motivo debe tener al menos 5 caracteres');
      await comoJefa('post', '/api/ventas/999999/anular').send({ motivo: 'No existe' }).expect(404);
    });
  });

  describe('movimientos de efectivo', () => {
    it('POST /api/caja/turno/movimientos registra un egreso en el turno abierto', async () => {
      const { body } = await conSesion('post', '/api/caja/turno/movimientos', enzo.acceso)
        .send({ tipo: 'egreso', monto: 200, motivo: ' Papel para los tickets ' })
        .expect(201);
      expect(body.movimiento as MovimientoCaja).toEqual({
        id: expect.any(Number),
        tipo: 'EGRESO',
        moneda: 'NIO',
        monto: '200.00',
        motivo: 'Papel para los tickets',
        usuario: { id: ids.enzo, nombre_completo: 'Enzo Pos' },
        fecha: expect.any(String),
      });
      const lista = await conSesion('get', '/api/caja/turno/movimientos', enzo.acceso).expect(200);
      expect(lista.body.movimientos).toEqual([body.movimiento]);
    });

    it('datos inválidos → 400', async () => {
      const { body } = await conSesion('post', '/api/caja/turno/movimientos', enzo.acceso)
        .send({ tipo: 'PRESTAMO', moneda: 'EUR', monto: 0, motivo: 'x' })
        .expect(400);
      expect(body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'tipo',
        'moneda',
        'monto',
        'motivo',
      ]);
    });
  });

  // En la gaveta debería haber C$3250: 1000 de apertura + 1200 + 300 + 450 + 250 + 250 de ventas
  // en efectivo − 200 del egreso (la venta anulada no cuenta); y US$30: 20 + 10.
  describe('cierre a ciegas', () => {
    /** Todo lo que la vendedora recibe durante el cierre: ahí no puede ir lo esperado. */
    const vistoPorVera: unknown[] = [];
    const conteoCorto = {
      efectivo: [
        { moneda: 'NIO', valor: 1000, cantidad: 3 },
        { moneda: 'usd', valor: '20.00', cantidad: 1 },
        { moneda: 'USD', valor: 10, cantidad: 1 },
      ],
      no_efectivo: [
        { metodo: 'tarjeta', monto: 132 },
        { metodo: 'TRANSFERENCIA', monto: '1080' },
      ],
      retiro_nio: 2000,
    };

    async function cerrar(cuerpo: Record<string, unknown>) {
      const respuesta = await conSesion('post', '/api/caja/turno/cerrar', vera.acceso).send(cuerpo);
      vistoPorVera.push(respuesta.body);
      return respuesta;
    }

    it('antes de cerrar, el turno no trae ningún monto', async () => {
      const { body } = await conSesion('get', '/api/caja/turno', vera.acceso).expect(200);
      vistoPorVera.push(body);
      expect(Object.keys(body.turno).sort()).toEqual([
        'abierto_por',
        'caja',
        'cierre_pide_justificacion',
        'fecha_apertura',
        'id',
        'sucursal',
      ]);
    });

    it('conteo mal armado → 400 o 422, sin gastar el reconteo', async () => {
      const invalido = await cerrar({
        efectivo: [{ moneda: 'EUR', valor: 0, cantidad: -1 }],
        no_efectivo: [{ metodo: '', monto: -1 }],
        retiro_nio: 'mucho',
      });
      expect(invalido.status).toBe(400);
      expect(invalido.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'efectivo.0.moneda',
        'efectivo.0.valor',
        'efectivo.0.cantidad',
        'no_efectivo.0.metodo',
        'no_efectivo.0.monto',
        'retiro_nio',
      ]);
      const billeteRaro = await cerrar({ efectivo: [{ moneda: 'NIO', valor: 3, cantidad: 1 }] });
      expect(billeteRaro.status).toBe(422);
      expect(billeteRaro.body.mensaje).toBe('Denominación o cantidad inválida: NIO 3');
      const metodoRaro = await cerrar({ no_efectivo: [{ metodo: 'CHEQUE', monto: 10 }] });
      expect(metodoRaro.body.mensaje).toBe('Método de pago o monto inválido en el arqueo: CHEQUE');
      const retiroDeMas = await cerrar({ ...conteoCorto, retiro_nio: 5000 });
      expect(retiroDeMas.status).toBe(422);
      expect(retiroDeMas.body.mensaje).toMatch(/^No se puede retirar más efectivo del contado/);

      const { body } = await conSesion('get', '/api/caja/turno', vera.acceso).expect(200);
      expect(body.turno.cierre_pide_justificacion).toBe(false);
    });

    it('primer conteo que no cuadra → 422 CONTEO_NO_CUADRA, sin montos, y la caja sigue abierta', async () => {
      const respuesta = await cerrar(conteoCorto);
      expect(respuesta.status).toBe(422);
      expect(respuesta.body).toEqual({
        codigo: 'CONTEO_NO_CUADRA',
        mensaje:
          'El conteo no cuadra con lo registrado. Cuente de nuevo: es el único reconteo; en el siguiente intento deberá escribir una justificación y la caja se cerrará con lo que cuente.',
      });
      const { body } = await conSesion('get', '/api/caja/turno', vera.acceso).expect(200);
      vistoPorVera.push(body);
      expect(body.turno).toMatchObject({ id: propio.turno, cierre_pide_justificacion: true });
    });

    it('solo hay un reconteo: después se pide la justificación, cuadre o no el conteo', async () => {
      const pideJustificacion = {
        codigo: 'REGLA_NEGOCIO',
        mensaje:
          'Ya se hizo un reconteo: escriba una justificación (mínimo 10 caracteres) y la caja se cerrará con lo contado',
      };
      const otraVezCorto = await cerrar(conteoCorto);
      expect(otraVezCorto.status).toBe(422);
      expect(otraVezCorto.body).toEqual(pideJustificacion);
      // con el conteo exacto responde lo mismo: así no se puede ir probando hasta acertar
      const exacto = await cerrar({
        ...conteoCorto,
        efectivo: [
          ...conteoCorto.efectivo,
          { moneda: 'NIO', valor: 200, cantidad: 1 },
          { moneda: 'NIO', valor: 50, cantidad: 1 },
        ],
        justificacion: 'corta',
      });
      expect(exacto.status).toBe(422);
      expect(exacto.body).toEqual(pideJustificacion);
    });

    it('con la justificación se cierra con lo contado; el ticket trae solo lo contado, el retiro y el fondo', async () => {
      const respuesta = await cerrar({
        ...conteoCorto,
        justificacion: 'Faltó registrar un egreso de la mañana',
        observaciones: 'Cierre de prueba',
      });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.ticket as TicketCierre).toEqual({
        turno_id: propio.turno,
        sucursal: 'Sucursal POS e2e',
        caja: 'Caja 1',
        abierto_por: 'Vera Pos',
        apertura: expect.any(String),
        cerrado_por: 'Vera Pos',
        cierre: expect.any(String),
        cierre_forzado: false,
        contado: [
          { metodo: 'Efectivo', moneda: 'NIO', monto: '3000.00' },
          { metodo: 'Efectivo', moneda: 'USD', monto: '30.00' },
          { metodo: 'Tarjeta', moneda: 'NIO', monto: '132.00' },
          { metodo: 'Transferencia', moneda: 'NIO', monto: '1080.00' },
        ],
        retiro_nio: '2000.00',
        retiro_usd: '0.00',
        fondo_siguiente_nio: '1000.00',
        fondo_siguiente_usd: '30.00',
      });

      const reimpreso = await conSesion(
        'get',
        `/api/turnos/${propio.turno}/ticket`,
        vera.acceso,
      ).expect(200);
      vistoPorVera.push(reimpreso.body);
      expect(reimpreso.body.ticket).toEqual(respuesta.body.ticket);
    });

    it('en todo el cierre la vendedora nunca recibió el monto esperado ni la diferencia', () => {
      const recibido = JSON.stringify(vistoPorVera);
      expect(recibido).not.toMatch(/esperado|diferencia|cobros|total_vendido/i);
      expect(recibido).not.toContain('3250'); // lo que el sistema esperaba en córdobas
      expect(recibido).not.toContain('-250'); // lo que faltó
    });

    it('la caja quedó cerrada: ya no se vende ni se registran movimientos', async () => {
      await conSesion('get', '/api/caja/turno', vera.acceso).expect(200).expect({ turno: null });
      const sinTurno = {
        codigo: 'SIN_TURNO_ABIERTO',
        mensaje: 'La caja no tiene un turno abierto: ábrala primero',
      };
      await vender(vera.acceso, { items: unAro(), pagos: efectivo(250) })
        .expect(409)
        .expect(sinTurno);
      await conSesion('post', '/api/caja/turno/cerrar', vera.acceso)
        .send({})
        .expect(409)
        .expect(sinTurno);
      await conSesion('get', '/api/caja/turno/movimientos', enzo.acceso)
        .expect(409)
        .expect(sinTurno);
      await conSesion('post', `/api/ventas/${venta.a}/anular`, enzo.acceso)
        .send({ motivo: 'Ya se cerró la caja' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La venta PVE-00000001 pertenece a un turno cerrado; registre una devolución',
        });
    });

    it('el faltante llega al administrador como alerta, con la justificación', async () => {
      const { body } = await comoJefa(
        'get',
        `/api/alertas?tipo=CAJA_DIFERENCIA&sucursal_id=${ids.suc}`,
      ).expect(200);
      expect(body.alertas as AlertaAdmin[]).toEqual([
        expect.objectContaining({
          tipo: 'CAJA_DIFERENCIA',
          titulo: 'Cierre con diferencia de C$ -250.00 en Sucursal POS e2e',
          detalle: expect.objectContaining({
            turno_id: propio.turno,
            diferencia_total_nio: -250,
            hubo_reconteo: true,
            justificacion: 'Faltó registrar un egreso de la mañana',
          }),
        }),
      ]);
    });
  });

  describe('historial de turnos (CAJA_VER_DIFERENCIAS)', () => {
    it('GET /api/turnos: el encargado ve lo esperado frente a lo contado', async () => {
      const { body } = await conSesion(
        'get',
        `/api/turnos?sucursal_id=${ids.suc}`,
        enzo.acceso,
      ).expect(200);
      expect(body.turnos as TurnoResumen[]).toEqual([
        {
          id: propio.turno,
          sucursal: { id: ids.suc, codigo: 'PVE', nombre: 'Sucursal POS e2e' },
          caja: { id: ids.caja, nombre: 'Caja 1' },
          estado: 'CERRADO',
          abierto_por: { id: ids.vera, nombre_completo: 'Vera Pos' },
          fecha_apertura: expect.any(String),
          cerrado_por: { id: ids.vera, nombre_completo: 'Vera Pos' },
          fecha_cierre: expect.any(String),
          cierre_forzado: false,
          ventas: 7,
          anuladas: 1,
          total_vendido: '4030.00',
          monto_inicial_nio: '1000.00',
          monto_inicial_usd: '20.00',
          diferencia_apertura_nio: null, // primer turno de la caja: no había fondo anterior
          diferencia_apertura_usd: null,
          diferencia_nio: '-250.00',
          diferencia_usd: '0.00',
          retiro_nio: '2000.00',
          retiro_usd: '0.00',
          fondo_siguiente_nio: '1000.00',
          fondo_siguiente_usd: '30.00',
          intentos_cierre: 1,
          justificacion_diferencia: 'Faltó registrar un egreso de la mañana',
          observaciones: 'Cierre de prueba',
        },
      ]);
    });

    it('GET /api/turnos/:id: arqueo por método, conteo por denominación y movimientos', async () => {
      const { body } = await conSesion('get', `/api/turnos/${propio.turno}`, enzo.acceso).expect(
        200,
      );
      const turno = body.turno as TurnoDetalle;
      const metodo = (codigo: string, nombre: string) => ({ codigo, nombre });
      expect(turno.arqueo).toEqual([
        {
          metodo: metodo('EFECTIVO', 'Efectivo'),
          moneda: 'NIO',
          esperado: '3250.00',
          contado: '3000.00',
          diferencia: '-250.00',
        },
        {
          metodo: metodo('EFECTIVO', 'Efectivo'),
          moneda: 'USD',
          esperado: '30.00',
          contado: '30.00',
          diferencia: '0.00',
        },
        {
          metodo: metodo('TARJETA', 'Tarjeta'),
          moneda: 'NIO',
          esperado: '132.00',
          contado: '132.00',
          diferencia: '0.00',
        },
        {
          metodo: metodo('TRANSFERENCIA', 'Transferencia'),
          moneda: 'NIO',
          esperado: '1080.00',
          contado: '1080.00',
          diferencia: '0.00',
        },
      ]);
      expect(turno.denominaciones).toEqual([
        { moneda: 'NIO', valor: '1000.00', cantidad: 3 },
        { moneda: 'USD', valor: '20.00', cantidad: 1 },
        { moneda: 'USD', valor: '10.00', cantidad: 1 },
      ]);
      expect(turno.movimientos).toEqual([
        expect.objectContaining({ tipo: 'EGRESO', monto: '200.00' }),
      ]);
      expect(turno).toMatchObject({ fondo_esperado_nio: null, intentos_cierre: 1 });
    });

    it('el ticket completo (con lo vendido y lo cobrado) solo llega con CAJA_VER_DIFERENCIAS', async () => {
      const { body } = await conSesion(
        'get',
        `/api/turnos/${propio.turno}/ticket`,
        enzo.acceso,
      ).expect(200);
      expect(body.ticket as TicketCierre).toMatchObject({
        turno_id: propio.turno,
        ventas: 7,
        anuladas: 1,
        total_vendido: '4030.00',
        descuentos_promociones: '120.00',
        cobros: [
          { metodo: 'Efectivo', moneda: 'NIO', monto: '2450.00' },
          { metodo: 'Efectivo', moneda: 'USD', monto: '10.00' },
          { metodo: 'Tarjeta', moneda: 'NIO', monto: '132.00' },
          { metodo: 'Transferencia', moneda: 'NIO', monto: '1080.00' },
        ],
        fondo_siguiente_nio: '1000.00',
      });
      expect(JSON.stringify(body.ticket)).not.toMatch(/esperado|diferencia/i);
    });

    it('filtros; un turno de otra sucursal responde 404', async () => {
      const lista = async (consulta: string): Promise<number[]> =>
        (
          (await comoJefa('get', `/api/turnos?sucursal_id=${ids.suc}${consulta}`).expect(200)).body
            .turnos as TurnoResumen[]
        ).map((t) => t.id);
      expect(await lista('&estado=cerrado')).toEqual([propio.turno]);
      expect(await lista('&estado=abierto')).toEqual([]);
      expect(await lista(`&desde=${hoyEnManagua()}`)).toEqual([propio.turno]);
      expect(await lista('&hasta=2020-01-01')).toEqual([]);
      expect(await lista(`&antes_de=${propio.turno}`)).toEqual([]);
      await comoJefa('get', '/api/turnos?estado=roto').expect(400);

      const noExiste = { codigo: 'NO_ENCONTRADO', mensaje: `El turno ${propio.turno} no existe` };
      // Lola (otra sucursal) puede cerrar su caja, pero este turno no es suyo
      await conSesion('get', `/api/turnos/${propio.turno}/ticket`, lola.acceso)
        .expect(404)
        .expect(noExiste);
      await comoJefa('get', '/api/turnos/999999').expect(404);
    });

    it('POST /api/turnos/:id/imprimir: el ticket de cierre en PDF; la reimpresión es copia', async () => {
      const imprimir = (acceso: string) =>
        conSesion('post', `/api/turnos/${propio.turno}/imprimir`, acceso)
          .buffer(true)
          .parse(comoBytes);

      // la vendedora que cerró imprime el suyo (el reducido)
      const original = await imprimir(vera.acceso).expect(200);
      expect(original.headers['content-type']).toBe('application/pdf');
      expect(original.headers['content-disposition']).toBe(
        `inline; filename="cierre-turno-${propio.turno}.pdf"`,
      );
      expect(original.headers['x-ticket-impresion']).toBe('1');
      const reducido = original.body as Buffer;
      expect(reducido.toString('latin1')).toMatch(/\/MediaBox \[0 0 226\.77\d* \d+(\.\d+)?\]/);

      // el encargado recibe el completo (más largo: lleva lo vendido y lo cobrado), ya como copia
      const copia = await imprimir(enzo.acceso).expect(200);
      expect(copia.headers['x-ticket-impresion']).toBe('2');
      const alto = (pdf: Buffer) =>
        Number(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/.exec(pdf.toString('latin1'))?.[1]);
      expect(alto(copia.body as Buffer)).toBeGreaterThan(alto(reducido));

      await conSesion('post', `/api/turnos/${propio.turno}/imprimir`, lola.acceso)
        .expect(404)
        .expect({ codigo: 'NO_ENCONTRADO', mensaje: `El turno ${propio.turno} no existe` });
      await comoJefa('post', '/api/turnos/999999/imprimir').expect(404);
    });
  });

  describe('apertura siguiente y cierre forzado', () => {
    it('desde la tablet se abre la única caja de la sucursal, a ciegas', async () => {
      const { body } = await conSesion('post', '/api/caja/turno/abrir', vera.enTablet)
        .send({ inicial_nio: 950, inicial_usd: 30 })
        .expect(201);
      expect(JSON.stringify(body)).not.toMatch(/fondo|diferencia|esperado/i);
      expect(body.turno).toMatchObject({
        caja: { id: ids.caja },
        cierre_pide_justificacion: false,
      });
      propio.turno2 = body.turno.id;
    });

    it('el encargado ve la diferencia de apertura y lo esperado hasta ahora', async () => {
      const { body } = await conSesion('get', `/api/turnos/${propio.turno2}`, enzo.acceso).expect(
        200,
      );
      expect(body.turno as TurnoDetalle).toMatchObject({
        estado: 'ABIERTO',
        fondo_esperado_nio: '1000.00',
        monto_inicial_nio: '950.00',
        diferencia_apertura_nio: '-50.00', // dentro de la tolerancia: sin alerta
        diferencia_apertura_usd: '0.00',
        diferencia_nio: null,
        arqueo: [
          {
            metodo: { codigo: 'EFECTIVO', nombre: 'Efectivo' },
            moneda: 'NIO',
            esperado: '950.00',
            contado: null,
            diferencia: null,
          },
          {
            metodo: { codigo: 'EFECTIVO', nombre: 'Efectivo' },
            moneda: 'USD',
            esperado: '30.00',
            contado: null,
            diferencia: null,
          },
        ],
      });
      const sigueAbierto = {
        codigo: 'TURNO_ABIERTO',
        mensaje: 'El turno sigue abierto: el ticket sale al cerrarlo',
      };
      await conSesion('get', `/api/turnos/${propio.turno2}/ticket`, enzo.acceso)
        .expect(409)
        .expect(sigueAbierto);
      await conSesion('post', `/api/turnos/${propio.turno2}/imprimir`, enzo.acceso)
        .expect(409)
        .expect(sigueAbierto);
    });

    it('POST /api/turnos/:id/cierre-forzado: el administrador cierra sin arqueo', async () => {
      const corto = await comoJefa('post', `/api/turnos/${propio.turno2}/cierre-forzado`)
        .send({ motivo: 'Nadie' })
        .expect(400);
      expect(corto.body.mensaje).toBe('El motivo debe tener al menos 10 caracteres');

      const { body } = await comoJefa('post', `/api/turnos/${propio.turno2}/cierre-forzado`)
        .send({ motivo: 'Nadie cerró la caja anoche' })
        .expect(200);
      expect(body.ticket as TicketCierre).toMatchObject({
        turno_id: propio.turno2,
        cierre_forzado: true,
        cerrado_por: 'Jefa del POS',
        ventas: 0,
        total_vendido: '0.00',
        cobros: [],
        fondo_siguiente_nio: '950.00',
        fondo_siguiente_usd: '30.00',
      });
      await comoJefa('post', `/api/turnos/${propio.turno2}/cierre-forzado`)
        .send({ motivo: 'Nadie cerró la caja anoche' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `El turno ${propio.turno2} no está abierto`,
        });
    });

    it('sin conteo no hay nada que mostrarle a la vendedora: su ticket no trae montos', async () => {
      const { body } = await conSesion(
        'get',
        `/api/turnos/${propio.turno2}/ticket`,
        vera.acceso,
      ).expect(200);
      expect(body.ticket).toEqual({
        turno_id: propio.turno2,
        sucursal: 'Sucursal POS e2e',
        caja: 'Caja 1',
        abierto_por: 'Vera Pos',
        apertura: expect.any(String),
        cerrado_por: 'Jefa del POS',
        cierre: expect.any(String),
        cierre_forzado: true,
      });
    });
  });

  describe('permisos', () => {
    it('una vendedora no mueve efectivo, no anula, no ve diferencias ni toca el tipo de cambio', async () => {
      const rutas: [Metodo, string, string][] = [
        ['get', '/api/caja/turno/movimientos', 'CAJA_MOVIMIENTOS'],
        ['post', '/api/caja/turno/movimientos', 'CAJA_MOVIMIENTOS'],
        ['get', '/api/turnos', 'CAJA_VER_DIFERENCIAS'],
        ['get', `/api/turnos/${propio.turno}`, 'CAJA_VER_DIFERENCIAS'],
        ['post', `/api/turnos/${propio.turno}/cierre-forzado`, 'CAJA_CIERRE_FORZADO'],
        ['post', `/api/ventas/${venta.a}/anular`, 'VENTAS_ANULAR'],
        ['put', '/api/tipo-cambio', 'TIPO_CAMBIO_GESTIONAR'],
        ['get', '/api/tipo-cambio/historial', 'TIPO_CAMBIO_GESTIONAR'],
      ];
      for (const [metodo, ruta, permiso] of rutas) {
        await conSesion(metodo, ruta, vera.acceso)
          .expect(403)
          .expect({
            codigo: 'PERMISO_DENEGADO',
            mensaje: `Permiso denegado: se requiere ${permiso}`,
          });
      }
      // el encargado sí ve las diferencias, pero el cierre forzado es del administrador
      await conSesion('post', `/api/turnos/${propio.turno}/cierre-forzado`, enzo.acceso)
        .send({ motivo: 'Nadie cerró la caja anoche' })
        .expect(403);
    });

    it('un equipo desactivado deja de servir al instante, aunque la sesión siga abierta', async () => {
      await comoJefa('put', `/api/equipos/${equipo.tablet.id}/activo`)
        .send({ activo: false })
        .expect(200);
      const rechazo = {
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Esta operación se hace desde un equipo registrado y activo de la sucursal',
      };
      await conSesion('get', '/api/caja/turno', vera.enTablet).expect(403).expect(rechazo);
      await conSesion('post', '/api/caja/turno/abrir', vera.enTablet)
        .send({ inicial_nio: 950 })
        .expect(403)
        .expect(rechazo);
      await vender(vera.enTablet, { items: unAro(), pagos: efectivo(250) })
        .expect(403)
        .expect(rechazo);
      // la PC de caja sigue funcionando
      await conSesion('get', '/api/caja/turno', vera.acceso).expect(200).expect({ turno: null });
    });
  });
});
