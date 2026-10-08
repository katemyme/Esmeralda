import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AlertaAdmin } from '../src/alertas/alertas.service';
import { BaseDatosService } from '../src/base-datos/base-datos.service';
import type { CompraDetalle, CompraResumen } from '../src/compras/compras.service';
import type { ConteoDetalle, DiferenciaConteo } from '../src/conteos/conteos.service';
import type { EnvioDetalle, EnvioResumen, SugerenciaReparto } from '../src/envios/envios.service';
import type { Existencia, Movimiento } from '../src/inventario/inventario.service';
import type { Merma } from '../src/mermas/mermas.service';
import type { ProductoCatalogo } from '../src/productos/productos.service';
import type { Proveedor } from '../src/proveedores/proveedores.service';
import { crearApp, crearUsuarioDePrueba, registrarTablet, tokenDeAcceso } from './utilidades';

// Recorrido completo de B5 (inventario) contra la base de pruebas: una compra entra a la bodega,
// se envía a Las Américas, la sucursal la recibe, reporta una merma y hace un conteo. Las pruebas
// van en orden y comparten estado. Usan actores y productos propios: las existencias de los datos
// demo no se tocan.

type Metodo = 'get' | 'post' | 'put' | 'delete';

function hoyEnManagua(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date());
}

describe('Inventario', () => {
  let app: NestExpressApplication;
  let http: App;
  let bd: BaseDatosService;
  const ids = { jefa: 0, vera: 0, lam: 0, lbr: 0, bod: 0, categoria: 0, servicio: 0, demo: 0 };
  /** Las dos piezas propias de estas pruebas. */
  const pieza = { anillo: 0, aro: 0 };
  const jefa = { acceso: '' };
  const vera = { acceso: '' };
  const propio = { proveedor: 0, compra: 0, envio: 0, numeroEnvio: '', merma: 0, conteo: 0 };

  function conSesion(metodo: Metodo, ruta: string, acceso: string) {
    return request(http)[metodo](ruta).set('Authorization', `Bearer ${acceso}`);
  }

  function comoJefa(metodo: Metodo, ruta: string) {
    return conSesion(metodo, ruta, jefa.acceso);
  }

  function comoVera(metodo: Metodo, ruta: string) {
    return conSesion(metodo, ruta, vera.acceso);
  }

  /** Cuánto hay de una pieza en una ubicación, según el admin. */
  async function stock(sucursalId: number, varianteId: number): Promise<number | null | undefined> {
    const { body } = await comoJefa(
      'get',
      `/api/inventario/existencias?sucursal_id=${sucursalId}&categoria_id=${ids.categoria}`,
    ).expect(200);
    return (body.existencias as Existencia[]).find((e) => e.variante.id === varianteId)?.cantidad;
  }

  async function movimientos(acceso: string, consulta: string): Promise<Movimiento[]> {
    return (await conSesion('get', `/api/inventario/movimientos${consulta}`, acceso).expect(200))
      .body.movimientos;
  }

  beforeAll(async () => {
    app = await crearApp();
    http = app.getHttpServer();
    bd = app.get(BaseDatosService);
    const sucursales = await bd.db.selectFrom('sucursal').select(['id', 'codigo']).execute();
    ids.lam = sucursales.find((s) => s.codigo === 'LAM')?.id ?? 0;
    ids.lbr = sucursales.find((s) => s.codigo === 'LBR')?.id ?? 0;
    ids.bod = sucursales.find((s) => s.codigo === 'BOD')?.id ?? 0;
    const variantes = await bd.db.selectFrom('variante').select(['id', 'sku']).execute();
    ids.servicio = variantes.find((v) => v.sku === 'SRV-LOB')?.id ?? 0;
    ids.demo = variantes.find((v) => v.sku === 'TIT-LAB-16-6')?.id ?? 0;

    ids.jefa = await crearUsuarioDePrueba(app, {
      nombre: 'Jefa de inventario',
      username: 'jefa.inventario',
      password: 'Inventario#2026',
      rol: 'ADMIN',
    });
    jefa.acceso = await tokenDeAcceso(app, 'jefa.inventario', 'Inventario#2026');
    ids.vera = await crearUsuarioDePrueba(app, {
      nombre: 'Vera Inventario',
      username: 'vera.inventario',
      password: 'Vendedora#2026',
      rol: 'VENDEDOR',
      sucursales: [ids.lam],
    });
    const tablet = await registrarTablet(app, jefa.acceso, 'Tablet de inventario', ids.lam);
    vera.acceso = await tokenDeAcceso(app, 'vera.inventario', 'Vendedora#2026', tablet);

    // Catálogo propio: una categoría con un producto de dos variantes
    const categoria = await comoJefa('post', '/api/categorias')
      .send({ nombre: 'Anillos B5' })
      .expect(201);
    ids.categoria = categoria.body.categoria.id;
    const producto = await comoJefa('post', '/api/productos')
      .send({
        categoria_id: ids.categoria,
        nombre: 'Anillo B5',
        variantes: [
          { sku: 'INV-B5-ANI', nombre: 'Anillo liso', precio_venta: 500 },
          { sku: 'INV-B5-ARO', nombre: 'Aro fino', precio_venta: 80 },
        ],
      })
      .expect(201);
    const creadas = (producto.body.producto as ProductoCatalogo).variantes;
    pieza.anillo = creadas.find((v) => v.sku === 'INV-B5-ANI')?.id ?? 0;
    pieza.aro = creadas.find((v) => v.sku === 'INV-B5-ARO')?.id ?? 0;
  });

  afterAll(() => app.close());

  it('sin sesión → 401 en las rutas de inventario', async () => {
    for (const ruta of ['proveedores', 'compras', 'envios', 'mermas', 'conteos']) {
      await request(http).get(`/api/${ruta}`).expect(401);
    }
    await request(http).get('/api/inventario/existencias').expect(401);
    await request(http).get('/api/inventario/movimientos').expect(401);
  });

  describe('proveedores', () => {
    it('POST /api/proveedores crea el proveedor', async () => {
      const { body } = await comoJefa('post', '/api/proveedores')
        .send({
          nombre: ' Joyas del Sur B5 ',
          pais: 'Nicaragua',
          moneda_habitual: 'nio',
          email: 'ventas@joyas.example',
        })
        .expect(201);
      expect(body.proveedor).toEqual({
        id: expect.any(Number),
        nombre: 'Joyas del Sur B5',
        pais: 'Nicaragua',
        moneda_habitual: 'NIO',
        contacto: null,
        telefono: null,
        email: 'ventas@joyas.example',
        activo: true,
        compras: 0,
      });
      propio.proveedor = body.proveedor.id;
    });

    it('nombre repetido → 409; datos inválidos → 400', async () => {
      const repetido = await comoJefa('post', '/api/proveedores')
        .send({ nombre: 'Joyas del Sur B5' })
        .expect(409);
      expect(repetido.body).toMatchObject({
        codigo: 'DUPLICADO',
        restriccion: 'proveedor_nombre_key',
      });
      const invalido = await comoJefa('post', '/api/proveedores')
        .send({ nombre: 'J', moneda_habitual: 'EUR', email: 'ventas@' })
        .expect(400);
      expect(invalido.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'nombre',
        'moneda_habitual',
        'email',
      ]);
    });

    it('PUT /api/proveedores/:id lo edita y GET /api/proveedores los lista', async () => {
      const { body } = await comoJefa('put', `/api/proveedores/${propio.proveedor}`)
        .send({
          nombre: 'Joyas del Sur B5',
          pais: 'Nicaragua',
          moneda_habitual: 'USD',
          contacto: 'Juana Pérez',
          telefono: '2255-0000',
        })
        .expect(200);
      expect(body.proveedor).toMatchObject({
        moneda_habitual: 'USD',
        contacto: 'Juana Pérez',
        telefono: '2255-0000',
        email: null,
      });
      const lista = await comoJefa('get', '/api/proveedores').expect(200);
      const nombres = (lista.body.proveedores as Proveedor[]).map((p) => p.nombre);
      expect(nombres).toEqual(expect.arrayContaining(['Body Jewelry Supply', 'Joyas del Sur B5']));
      await comoJefa('put', '/api/proveedores/999999')
        .send({ nombre: 'Nadie' })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'El proveedor 999999 no existe' });
    });

    it('a un proveedor inactivo no se le registran compras (regla de la base)', async () => {
      const inactivo = await comoJefa('put', `/api/proveedores/${propio.proveedor}/activo`)
        .send({ activo: false })
        .expect(200);
      expect(inactivo.body.proveedor.activo).toBe(false);
      await comoJefa('post', '/api/compras')
        .send({
          proveedor_id: propio.proveedor,
          factura_numero: 'B5-000',
          fecha_factura: hoyEnManagua(),
          moneda: 'NIO',
        })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `El proveedor ${propio.proveedor} no existe o está inactivo`,
        });
      await comoJefa('put', `/api/proveedores/${propio.proveedor}/activo`)
        .send({ activo: true })
        .expect(200);
    });
  });

  describe('compras', () => {
    it('POST /api/compras abre la compra en borrador con sus líneas y gastos, y calcula el costeo', async () => {
      const { body } = await comoJefa('post', '/api/compras')
        .send({
          proveedor_id: propio.proveedor,
          factura_numero: ' B5-001 ',
          fecha_factura: hoyEnManagua(),
          moneda: 'usd',
          tipo_cambio: 36.5,
          notas: 'Primera compra',
          lineas: [
            { variante_id: pieza.anillo, cantidad_facturada: 10, costo_unitario: 2 },
            {
              variante_id: pieza.aro,
              cantidad_facturada: 20,
              costo_unitario: '1.25',
              cantidad_recibida: 18,
            },
          ],
          gastos: [{ concepto: 'courier', moneda: 'USD', monto: 10, descripcion: 'DHL' }],
        })
        .expect(201);
      const compra = body.compra as CompraDetalle;
      propio.compra = compra.id;
      expect(compra).toMatchObject({
        proveedor: { id: propio.proveedor, nombre: 'Joyas del Sur B5' },
        factura_numero: 'B5-001',
        fecha_factura: hoyEnManagua(),
        moneda: 'USD',
        tipo_cambio: '36.5000',
        estado: 'BORRADOR',
        notas: 'Primera compra',
        lineas: 2,
        piezas_facturadas: 30,
        piezas_recibidas: 28,
        faltantes: 2,
        total_factura: '45.00', // 10 × 2 + 20 × 1.25
        total_factura_nio: '1642.50', // × 36.50
        gastos_nio: '365.00', // US$10 × 36.50
        costo_total_nio: '2007.50',
        creada_por: { id: ids.jefa, nombre_completo: 'Jefa de inventario' },
        confirmada_por: null,
        fecha_confirmacion: null,
      });
      // Vista previa: el gasto se reparte en proporción al valor de cada línea
      expect(compra.detalle).toEqual([
        {
          detalle_id: expect.any(Number),
          variante: { id: pieza.anillo, sku: 'INV-B5-ANI', nombre: 'Anillo B5 — Anillo liso' },
          cantidad_facturada: 10,
          cantidad_recibida: 10,
          costo_unitario_factura: '2.0000',
          valor_nio: '730.00',
          gasto_asignado_nio: '162.22',
          costo_unitario_final_nio: '89.2220',
          costo_promedio_nuevo: '89.22',
          precio_venta: '500.00',
          costo_actual: '0.00',
          stock_actual: 0,
          margen_nuevo_pct: '82.2',
          alerta_margen: false,
        },
        {
          detalle_id: expect.any(Number),
          variante: { id: pieza.aro, sku: 'INV-B5-ARO', nombre: 'Anillo B5 — Aro fino' },
          cantidad_facturada: 20,
          cantidad_recibida: 18,
          costo_unitario_factura: '1.2500',
          valor_nio: '912.50',
          gasto_asignado_nio: '202.78',
          costo_unitario_final_nio: '55.7640',
          costo_promedio_nuevo: '55.76',
          precio_venta: '80.00',
          costo_actual: '0.00',
          stock_actual: 0,
          margen_nuevo_pct: '30.3', // por debajo del 40 %: avisará al confirmar
          alerta_margen: true,
        },
      ]);
      expect(compra.gastos).toEqual([
        {
          id: expect.any(Number),
          concepto: 'COURIER',
          descripcion: 'DHL',
          moneda: 'USD',
          monto: '10.00',
          tipo_cambio: '36.5000',
          monto_nio: '365.00',
        },
      ]);
      expect(await stock(ids.bod, pieza.anillo)).toBe(0); // un borrador no mueve inventario
    });

    it('datos inválidos → 400; reglas de la base con su mensaje', async () => {
      const base = {
        proveedor_id: propio.proveedor,
        fecha_factura: hoyEnManagua(),
        moneda: 'USD',
      };
      const invalida = await comoJefa('post', '/api/compras')
        .send({
          ...base,
          fecha_factura: 'ayer',
          moneda: 'EUR',
          lineas: [
            {
              variante_id: pieza.anillo,
              cantidad_facturada: 2,
              costo_unitario: 1,
              cantidad_recibida: 3,
            },
          ],
        })
        .expect(400);
      expect(invalida.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'factura_numero',
        'fecha_factura',
        'moneda',
        'lineas.0.cantidad_recibida',
      ]);
      await comoJefa('post', '/api/compras')
        .send({ ...base, factura_numero: 'B5-001' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La factura B5-001 de este proveedor ya fue registrada',
        });
      // con una línea inválida no se crea nada: ni la compra
      await comoJefa('post', '/api/compras')
        .send({
          ...base,
          factura_numero: 'B5-SERVICIO',
          lineas: [{ variante_id: ids.servicio, cantidad_facturada: 1, costo_unitario: 1 }],
        })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `Solo se compran piezas y artículos con stock (variante ${ids.servicio})`,
        });
      const lista = await comoJefa('get', `/api/compras?proveedor_id=${propio.proveedor}`).expect(
        200,
      );
      expect((lista.body.compras as CompraResumen[]).map((c) => c.factura_numero)).toEqual([
        'B5-001',
      ]);
    });

    it('en borrador se corrige el encabezado y se agregan o quitan líneas y gastos', async () => {
      const ruta = `/api/compras/${propio.compra}`;
      const encabezado = await comoJefa('put', ruta)
        .send({
          proveedor_id: propio.proveedor,
          factura_numero: 'B5-001A',
          fecha_factura: hoyEnManagua(),
          moneda: 'USD',
          tipo_cambio: '36.50',
        })
        .expect(200);
      expect(encabezado.body.compra).toMatchObject({
        factura_numero: 'B5-001A',
        notas: null,
        lineas: 2,
      });

      const conLinea = await comoJefa('put', `${ruta}/lineas`)
        .send({ variante_id: ids.demo, cantidad_facturada: 4, costo_unitario: 6 })
        .expect(200);
      expect(conLinea.body.compra.lineas).toBe(3);
      const sinLinea = await comoJefa('delete', `${ruta}/lineas/${ids.demo}`).expect(200);
      expect((sinLinea.body.compra as CompraDetalle).detalle.map((d) => d.variante.id)).toEqual([
        pieza.anillo,
        pieza.aro,
      ]);

      const conGasto = await comoJefa('post', `${ruta}/gastos`)
        .send({ concepto: 'ADUANA', moneda: 'NIO', monto: '100.50' })
        .expect(201);
      const gastos = (conGasto.body.compra as CompraDetalle).gastos;
      expect(gastos.map((g) => [g.concepto, g.monto_nio])).toEqual([
        ['COURIER', '365.00'],
        ['ADUANA', '100.50'],
      ]);
      expect(conGasto.body.compra.gastos_nio).toBe('465.50');
      const sinGasto = await comoJefa('delete', `${ruta}/gastos/${gastos[1].id}`).expect(200);
      expect(sinGasto.body.compra.gastos_nio).toBe('365.00');
      await comoJefa('delete', `${ruta}/gastos/999999`)
        .expect(404)
        .expect({
          codigo: 'NO_ENCONTRADO',
          mensaje: `El gasto 999999 no es de la compra ${propio.compra}`,
        });
    });

    it('GET /api/compras filtra por estado, proveedor y fecha de factura', async () => {
      const compras = async (consulta: string): Promise<CompraResumen[]> =>
        (await comoJefa('get', `/api/compras${consulta}`).expect(200)).body.compras;
      const hoy = hoyEnManagua();
      const filtro = `?proveedor_id=${propio.proveedor}`;
      expect((await compras(`${filtro}&estado=borrador`)).map((c) => c.id)).toEqual([
        propio.compra,
      ]);
      expect(await compras(`${filtro}&estado=CONFIRMADA`)).toEqual([]);
      expect(await compras(`${filtro}&desde=${hoy}&hasta=${hoy}`)).toHaveLength(1);
      expect(await compras(`${filtro}&hasta=2020-01-01`)).toEqual([]);
      const invalido = await comoJefa('get', '/api/compras?estado=pagada').expect(400);
      expect(invalido.body.errores[0].campo).toBe('estado');
    });

    it('POST /api/compras/:id/confirmar entra la mercadería a la bodega con su costo', async () => {
      const { body } = await comoJefa('post', `/api/compras/${propio.compra}/confirmar`).expect(
        200,
      );
      expect(body.resultado).toEqual([
        {
          producto: 'Anillo B5 — Anillo liso',
          cantidad_recibida: 10,
          faltantes: 0,
          costo_unitario_final_nio: '89.2220',
          costo_promedio_nuevo: '89.22',
          margen_nuevo_pct: '82.2',
          alerta_margen: false,
        },
        {
          producto: 'Anillo B5 — Aro fino',
          cantidad_recibida: 18,
          faltantes: 2,
          costo_unitario_final_nio: '55.7640',
          costo_promedio_nuevo: '55.76',
          margen_nuevo_pct: '30.3',
          alerta_margen: true,
        },
      ]);
      const compra = body.compra as CompraDetalle;
      expect(compra).toMatchObject({
        estado: 'CONFIRMADA',
        confirmada_por: { id: ids.jefa, nombre_completo: 'Jefa de inventario' },
        fecha_confirmacion: expect.any(String),
      });
      // ya confirmada, el detalle muestra lo que se guardó (sin la vista previa)
      expect(compra.detalle[0]).toMatchObject({
        gasto_asignado_nio: '162.22',
        costo_unitario_final_nio: '89.2220',
        costo_promedio_nuevo: '89.22',
        costo_actual: null,
        stock_actual: null,
        alerta_margen: null,
      });

      expect(await stock(ids.bod, pieza.anillo)).toBe(10);
      expect(await stock(ids.bod, pieza.aro)).toBe(18); // lo recibido, no lo facturado
      const alertas = await comoJefa('get', '/api/alertas?tipo=MARGEN_BAJO&limite=1').expect(200);
      expect((alertas.body.alertas as AlertaAdmin[])[0]).toMatchObject({
        titulo: 'Margen bajo: Anillo B5 — Aro fino (30.3 %)',
        detalle: { compra_id: propio.compra, variante_id: pieza.aro },
      });
    });

    it('una compra confirmada ya no se toca (regla de la base)', async () => {
      const ruta = `/api/compras/${propio.compra}`;
      await comoJefa('put', `${ruta}/lineas`)
        .send({ variante_id: pieza.anillo, cantidad_facturada: 1, costo_unitario: 1 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'La compra ya está confirmada y no se puede modificar',
        });
      await comoJefa('post', `${ruta}/confirmar`)
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La compra ${propio.compra} ya está confirmada`,
        });
      await comoJefa('post', `${ruta}/cancelar`).send({ motivo: 'Me equivoqué' }).expect(422);
    });

    it('POST /api/compras/:id/cancelar descarta un borrador', async () => {
      const borrador = await comoJefa('post', '/api/compras')
        .send({
          proveedor_id: propio.proveedor,
          factura_numero: 'B5-002',
          fecha_factura: hoyEnManagua(),
          moneda: 'NIO',
        })
        .expect(201);
      expect(borrador.body.compra).toMatchObject({ moneda: 'NIO', tipo_cambio: '1.0000' });
      const { body } = await comoJefa('post', `/api/compras/${borrador.body.compra.id}/cancelar`)
        .send({ motivo: 'Pedido duplicado' })
        .expect(200);
      expect(body.compra).toMatchObject({
        estado: 'CANCELADA',
        notas: 'Cancelada: Pedido duplicado',
      });
      const sinMotivo = await comoJefa('post', `/api/compras/${propio.compra}/cancelar`)
        .send({})
        .expect(400);
      expect(sinMotivo.body.errores).toEqual([{ campo: 'motivo', mensaje: 'Escriba el motivo' }]);
    });

    it('compra inexistente → 404; la vendedora no entra a compras ni a proveedores', async () => {
      await comoJefa('get', '/api/compras/999999').expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'La compra 999999 no existe',
      });
      await comoJefa('put', '/api/compras/999999/lineas')
        .send({ variante_id: pieza.anillo, cantidad_facturada: 1, costo_unitario: 1 })
        .expect(404);
      const rutas: [Metodo, string][] = [
        ['get', '/api/proveedores'],
        ['post', '/api/proveedores'],
        ['get', '/api/compras'],
        ['get', `/api/compras/${propio.compra}`],
        ['post', '/api/compras'],
        ['post', `/api/compras/${propio.compra}/confirmar`],
      ];
      for (const [metodo, ruta] of rutas) {
        await comoVera(metodo, ruta).expect(403).expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere INVENTARIO_ENTRADA',
        });
      }
    });
  });

  describe('existencias, movimientos manuales y stock mínimo', () => {
    it('GET /api/inventario/existencias: lo que hay en una ubicación, con su costo', async () => {
      const { body } = await comoJefa(
        'get',
        `/api/inventario/existencias?sucursal_id=${ids.bod}&categoria_id=${ids.categoria}`,
      ).expect(200);
      expect(body.sucursal).toMatchObject({ id: ids.bod, codigo: 'BOD', tipo: 'BODEGA' });
      expect(body.total).toBe(2);
      expect(body.existencias).toEqual([
        {
          variante: {
            id: pieza.anillo,
            sku: 'INV-B5-ANI',
            producto: 'Anillo B5',
            variante: 'Anillo liso',
            categoria: 'Anillos B5',
          },
          cantidad: 10,
          disponible: true,
          stock_minimo: 0,
          en_transito_entrante: 0,
          alerta_stock_bajo: false,
          precio_venta: '500.00',
          costo: '89.22',
          valor_costo: '892.20',
        },
        expect.objectContaining({ cantidad: 18, costo: '55.76', valor_costo: '1003.68' }),
      ]);
    });

    it('la vendedora no ve costos ni la cantidad exacta de la bodega', async () => {
      const bodega = await comoVera(
        'get',
        `/api/inventario/existencias?sucursal_id=${ids.bod}&buscar=inv-b5`,
      ).expect(200);
      expect(bodega.body.existencias).toEqual([
        expect.objectContaining({
          cantidad: null,
          disponible: true,
          en_transito_entrante: null,
          alerta_stock_bajo: null,
          costo: null,
          valor_costo: null,
        }),
        expect.objectContaining({ cantidad: null, disponible: true, costo: null }),
      ]);
      // sin indicar sucursal: la del equipo desde el que entró (Las Américas), donde aún no hay nada
      const propia = await comoVera('get', '/api/inventario/existencias?buscar=INV-B5').expect(200);
      expect(propia.body.sucursal.codigo).toBe('LAM');
      expect(
        (propia.body.existencias as Existencia[]).map((e) => [e.cantidad, e.disponible]),
      ).toEqual([
        [0, false],
        [0, false],
      ]);
    });

    it('sin equipo hay que indicar la ubicación; busca por texto y pagina', async () => {
      await comoJefa('get', '/api/inventario/existencias').expect(400).expect({
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Indique la ubicación (sucursal_id): esta sesión no es de un equipo registrado',
      });
      await comoJefa('get', '/api/inventario/existencias?sucursal_id=999999').expect(404);
      const filtro = `?sucursal_id=${ids.bod}&categoria_id=${ids.categoria}`;
      const pagina = await comoJefa(
        'get',
        `/api/inventario/existencias${filtro}&limite=1&desplazamiento=1`,
      ).expect(200);
      expect(pagina.body.total).toBe(2);
      expect((pagina.body.existencias as Existencia[]).map((e) => e.variante.sku)).toEqual([
        'INV-B5-ARO',
      ]);
      const buscada = await comoJefa(
        'get',
        `/api/inventario/existencias${filtro}&buscar=liso`,
      ).expect(200);
      expect(buscada.body.total).toBe(1);
    });

    it('PUT /api/inventario/stock-minimo fija el mínimo y enciende la alerta de stock bajo', async () => {
      await comoJefa('put', '/api/inventario/stock-minimo')
        .send({ sucursal_id: ids.lam, variante_id: pieza.anillo, stock_minimo: 5 })
        .expect(200)
        .expect({ sucursal_id: ids.lam, variante_id: pieza.anillo, stock_minimo: 5 });
      const bajos = await comoJefa(
        'get',
        `/api/inventario/existencias?sucursal_id=${ids.lam}&categoria_id=${ids.categoria}&solo_bajo_minimo=true`,
      ).expect(200);
      expect(
        (bajos.body.existencias as Existencia[]).map((e) => [
          e.variante.sku,
          e.cantidad,
          e.stock_minimo,
          e.alerta_stock_bajo,
        ]),
      ).toEqual([['INV-B5-ANI', 0, 5, true]]);
      await comoJefa('put', '/api/inventario/stock-minimo')
        .send({ sucursal_id: ids.lam, variante_id: ids.servicio, stock_minimo: 1 })
        .expect(422);
      await comoVera('put', '/api/inventario/stock-minimo')
        .send({ sucursal_id: ids.lam, variante_id: pieza.anillo, stock_minimo: 1 })
        .expect(403);
    });

    it('POST /api/inventario/movimientos registra un ajuste con su motivo', async () => {
      const { body } = await comoJefa('post', '/api/inventario/movimientos')
        .send({
          sucursal_id: ids.bod,
          variante_id: pieza.aro,
          tipo: 'ajuste_negativo',
          cantidad: 1,
          motivo: 'Llegó doblado y se desechó',
        })
        .expect(201);
      expect(body.movimiento).toEqual({
        id: expect.any(Number),
        fecha: expect.any(String),
        tipo: 'AJUSTE_NEGATIVO',
        cantidad: -1,
        stock_resultante: 17,
        costo_unitario: '55.76',
        motivo: 'Llegó doblado y se desechó',
        sucursal: { id: ids.bod, codigo: 'BOD', nombre: 'Bodega central' },
        variante: { id: pieza.aro, sku: 'INV-B5-ARO', nombre: 'Anillo B5 — Aro fino' },
        usuario: { id: ids.jefa, nombre_completo: 'Jefa de inventario' },
        venta_id: null,
        envio_id: null,
        compra_id: null,
        devolucion_id: null,
      });
    });

    it('movimientos inválidos: sin motivo → 400; reglas de la base → su mensaje', async () => {
      const base = { sucursal_id: ids.bod, variante_id: pieza.aro, cantidad: 1 };
      const sinMotivo = await comoJefa('post', '/api/inventario/movimientos')
        .send({ ...base, tipo: 'MERMA' })
        .expect(400);
      expect(sinMotivo.body.errores).toEqual([
        {
          campo: 'motivo',
          mensaje: 'Explique el motivo del ajuste o de la merma (al menos 5 caracteres)',
        },
      ]);
      await comoJefa('post', '/api/inventario/movimientos')
        .send({ ...base, tipo: 'VENTA', motivo: 'no se puede' })
        .expect(400);
      await comoJefa('post', '/api/inventario/movimientos')
        .send({ ...base, sucursal_id: ids.lam, tipo: 'ENTRADA' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje:
            'Las entradas de mercadería solo se registran en la bodega central; a las sucursales llega por envío',
        });
      await comoJefa('post', '/api/inventario/movimientos')
        .send({ ...base, tipo: 'AJUSTE_NEGATIVO', cantidad: 500, motivo: 'Se perdió todo' })
        .expect(422);
      await comoVera('post', '/api/inventario/movimientos')
        .send({ ...base, tipo: 'AJUSTE_POSITIVO', motivo: 'Apareció una' })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere INVENTARIO_ENTRADA o INVENTARIO_AJUSTAR',
        });
      expect(await stock(ids.bod, pieza.aro)).toBe(17);
    });

    it('GET /api/inventario/movimientos: el kardex de una pieza, del más reciente al más antiguo', async () => {
      const kardex = await movimientos(jefa.acceso, `?variante_id=${pieza.aro}`);
      expect(kardex.map((m) => [m.tipo, m.cantidad, m.stock_resultante, m.compra_id])).toEqual([
        ['AJUSTE_NEGATIVO', -1, 17, null],
        ['ENTRADA', 18, 18, propio.compra],
      ]);
      expect(kardex[1].motivo).toBe('Compra factura B5-001A');
      const hoy = hoyEnManagua();
      expect(
        await movimientos(jefa.acceso, `?variante_id=${pieza.aro}&tipo=entrada&desde=${hoy}`),
      ).toHaveLength(1);
      expect(await movimientos(jefa.acceso, `?variante_id=${pieza.aro}&hasta=2020-01-01`)).toEqual(
        [],
      );
      // cada quien ve el kardex de sus sucursales: Vera no trabaja en la bodega
      expect(await movimientos(vera.acceso, `?variante_id=${pieza.aro}`)).toEqual([]);
    });
  });

  describe('envíos', () => {
    it('GET /api/envios/sugerencia reparte primero lo que falta para el stock mínimo', async () => {
      const { body } = await comoJefa(
        'get',
        `/api/envios/sugerencia?variante_id=${pieza.anillo}&cantidad=6`,
      ).expect(200);
      const sugerencia = body.sugerencia as SugerenciaReparto[];
      expect(sugerencia.find((s) => s.sucursal_id === ids.lam)).toEqual({
        sucursal_id: ids.lam,
        sucursal: 'Multicentro Las Américas',
        stock: 0,
        stock_minimo: 5,
        en_transito: 0,
        vendidas_30d: 0,
        sugerido: expect.any(Number),
      });
      expect(sugerencia.find((s) => s.sucursal_id === ids.lam)?.sugerido).toBeGreaterThanOrEqual(5);
      expect(sugerencia.reduce((suma, s) => suma + s.sugerido, 0)).toBe(6);
      await comoJefa('get', '/api/envios/sugerencia?variante_id=999999&cantidad=6').expect(404);
      await comoJefa('get', `/api/envios/sugerencia?variante_id=${pieza.anillo}`).expect(400);
    });

    it('POST /api/envios crea el envío en borrador con sus líneas', async () => {
      const { body } = await comoJefa('post', '/api/envios')
        .send({
          origen_id: ids.bod,
          destino_id: ids.lam,
          notas: 'Reposición',
          lineas: [
            { variante_id: pieza.anillo, cantidad: 6 },
            { variante_id: pieza.aro, cantidad: 5 },
          ],
        })
        .expect(201);
      const envio = body.envio as EnvioDetalle;
      propio.envio = envio.id;
      expect(envio).toMatchObject({
        numero: null,
        origen: { id: ids.bod, codigo: 'BOD', nombre: 'Bodega central' },
        destino: { id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
        estado: 'BORRADOR',
        notas: 'Reposición',
        lineas: 2,
        piezas_enviadas: 11,
        piezas_recibidas: null,
        faltantes: null,
        creado_por: { id: ids.jefa, nombre_completo: 'Jefa de inventario' },
        enviado_por: null,
        fecha_envio: null,
      });
      expect(
        envio.detalle.map((d) => [d.variante.sku, d.cantidad_enviada, d.costo_unitario]),
      ).toEqual([
        ['INV-B5-ANI', 6, null], // el costo se fija al enviar
        ['INV-B5-ARO', 5, null],
      ]);
    });

    it('PUT /api/envios/:id/lineas cambia una cantidad o (con 0) quita la pieza', async () => {
      const ruta = `/api/envios/${propio.envio}/lineas`;
      const menos = await comoJefa('put', ruta)
        .send({ variante_id: pieza.aro, cantidad: 4 })
        .expect(200);
      expect(menos.body.envio.piezas_enviadas).toBe(10);
      const quitada = await comoJefa('put', ruta)
        .send({ variante_id: pieza.aro, cantidad: 0 })
        .expect(200);
      expect(quitada.body.envio.lineas).toBe(1);
      await comoJefa('put', ruta).send({ variante_id: pieza.aro, cantidad: 4 }).expect(200);
      await comoJefa('put', ruta)
        .send({ variante_id: ids.servicio, cantidad: 1 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `Solo se envían piezas y artículos con stock (variante ${ids.servicio})`,
        });
    });

    it('datos inválidos → 400; solo quien traslada crea envíos', async () => {
      const mismo = await comoJefa('post', '/api/envios')
        .send({ origen_id: ids.bod, destino_id: ids.bod })
        .expect(400);
      expect(mismo.body.errores).toEqual([
        { campo: 'destino_id', mensaje: 'El destino debe ser distinto del origen' },
      ]);
      await comoVera('post', '/api/envios')
        .send({ origen_id: ids.lam, destino_id: ids.lbr })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere INVENTARIO_TRASLADAR',
        });
    });

    it('POST /api/envios/:id/enviar saca la mercadería del origen y deja el envío en tránsito', async () => {
      const { body } = await comoJefa('post', `/api/envios/${propio.envio}/enviar`).expect(200);
      const envio = body.envio as EnvioDetalle;
      propio.numeroEnvio = envio.numero ?? '';
      expect(envio).toMatchObject({
        numero: expect.stringMatching(/^ENV-\d{6}$/),
        estado: 'EN_TRANSITO',
        enviado_por: { id: ids.jefa, nombre_completo: 'Jefa de inventario' },
        fecha_envio: expect.any(String),
        fecha_recepcion: null,
      });
      expect(envio.detalle.map((d) => d.costo_unitario)).toEqual(['89.22', '55.76']);
      expect(await stock(ids.bod, pieza.anillo)).toBe(4);
      expect(await stock(ids.bod, pieza.aro)).toBe(13);
      expect(await stock(ids.lam, pieza.anillo)).toBe(0); // todavía no llega
    });

    it('no se envía más de lo que hay, y un envío en tránsito no se cancela (reglas de la base)', async () => {
      const grande = await comoJefa('post', '/api/envios')
        .send({
          origen_id: ids.bod,
          destino_id: ids.lbr,
          lineas: [{ variante_id: pieza.anillo, cantidad: 100 }],
        })
        .expect(201);
      const sinStock = await comoJefa('post', `/api/envios/${grande.body.envio.id}/enviar`).expect(
        422,
      );
      expect(sinStock.body.mensaje).toMatch(/^Stock insuficiente de "Anillo B5 — Anillo liso"/);
      expect(await stock(ids.bod, pieza.anillo)).toBe(4);

      // Vera (Las Américas) no ve un envío de la bodega a Las Brisas
      await comoVera('get', `/api/envios/${grande.body.envio.id}`).expect(404);
      const cancelado = await comoJefa('post', `/api/envios/${grande.body.envio.id}/cancelar`)
        .send({ motivo: 'No hay suficiente' })
        .expect(200);
      expect(cancelado.body.envio).toMatchObject({
        estado: 'CANCELADO',
        notas: 'Cancelado: No hay suficiente',
      });
      await comoJefa('post', `/api/envios/${propio.envio}/cancelar`)
        .send({ motivo: 'Ya salió' })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Solo se cancela un envío en borrador; uno en tránsito debe recibirse',
        });
    });

    it('la sucursal ve lo que tiene por recibir, sin costos', async () => {
      const { body } = await comoVera(
        'get',
        `/api/envios?estado=en_transito&destino_id=${ids.lam}`,
      ).expect(200);
      const porRecibir = body.envios as EnvioResumen[];
      expect(porRecibir.map((e) => e.id)).toContain(propio.envio);
      const detalle = await comoVera('get', `/api/envios/${propio.envio}`).expect(200);
      expect(
        (detalle.body.envio as EnvioDetalle).detalle.map((d) => [
          d.variante.sku,
          d.cantidad_enviada,
          d.cantidad_recibida,
          d.costo_unitario,
        ]),
      ).toEqual([
        ['INV-B5-ANI', 6, null, null],
        ['INV-B5-ARO', 4, null, null],
      ]);
    });

    it('al recibir no se acepta ni más de lo enviado ni piezas que no vienen (reglas de la base)', async () => {
      const ruta = `/api/envios/${propio.envio}/recibir`;
      await comoVera('post', ruta)
        .send({ recibido: [{ variante_id: pieza.anillo, cantidad: 7 }] })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Se escanearon más piezas de las enviadas; revise el conteo',
        });
      await comoVera('post', ruta)
        .send({ recibido: [{ variante_id: ids.demo, cantidad: 1 }] })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `Estas piezas no vienen en el envío ${propio.numeroEnvio}: ${ids.demo}`,
        });
      await comoVera('post', ruta).send({}).expect(400);
      expect(await stock(ids.lam, pieza.anillo)).toBe(0);
    });

    it('POST /api/envios/:id/recibir entra lo escaneado; si falta algo, queda con diferencias y alerta', async () => {
      const { body } = await comoVera('post', `/api/envios/${propio.envio}/recibir`)
        .send({
          recibido: [
            // escaneando pieza por pieza: la misma variante puede venir varias veces
            { variante_id: pieza.anillo, cantidad: 3 },
            { variante_id: pieza.aro, cantidad: 3 },
            { variante_id: pieza.anillo, cantidad: 3 },
          ],
        })
        .expect(200);
      const envio = body.envio as EnvioDetalle;
      expect(envio).toMatchObject({
        estado: 'RECIBIDO_CON_DIFERENCIAS',
        piezas_enviadas: 10,
        piezas_recibidas: 9,
        faltantes: 1,
        recibido_por: { id: ids.vera, nombre_completo: 'Vera Inventario' },
        fecha_recepcion: expect.any(String),
      });
      expect(envio.detalle.map((d) => [d.variante.sku, d.cantidad_recibida])).toEqual([
        ['INV-B5-ANI', 6],
        ['INV-B5-ARO', 3],
      ]);
      expect(await stock(ids.lam, pieza.anillo)).toBe(6);
      expect(await stock(ids.lam, pieza.aro)).toBe(3);

      const alertas = await comoJefa('get', '/api/alertas?tipo=ENVIO_DIFERENCIA&limite=1').expect(
        200,
      );
      expect((alertas.body.alertas as AlertaAdmin[])[0]).toMatchObject({
        titulo: `Envío ${propio.numeroEnvio}: faltan 1 pieza(s) al recibir`,
        sucursal: { id: ids.lam },
        detalle: { envio_id: propio.envio, recibido_por: ids.vera },
      });
      // un envío ya recibido no se recibe otra vez
      await comoVera('post', `/api/envios/${propio.envio}/recibir`)
        .send({ recibido: [] })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `El envío ${propio.numeroEnvio} no está en tránsito (estado: RECIBIDO_CON_DIFERENCIAS)`,
        });
    });

    it('GET /api/envios filtra por estado y destino; envío inexistente → 404', async () => {
      const envios = async (consulta: string): Promise<EnvioResumen[]> =>
        (await comoJefa('get', `/api/envios${consulta}`).expect(200)).body.envios;
      const recibidos = await envios(
        `?estado=RECIBIDO_CON_DIFERENCIAS&destino_id=${ids.lam}&origen_id=${ids.bod}`,
      );
      expect(recibidos.map((e) => e.id)).toContain(propio.envio);
      expect((await envios('?estado=cancelado&limite=1'))[0]).toMatchObject({
        estado: 'CANCELADO',
        destino: { codigo: 'LBR' },
      });
      await comoJefa('get', '/api/envios/999999').expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'El envío 999999 no existe',
      });
      await comoJefa('post', '/api/envios/999999/enviar')
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'El envío 999999 no existe' });
      const invalido = await comoJefa('get', '/api/envios?estado=perdido').expect(400);
      expect(invalido.body.errores[0].campo).toBe('estado');
    });
  });

  describe('mermas', () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const otra = { merma: 0 };

    it('POST /api/mermas: la sucursal reporta la pieza dañada, con su foto, sin descontarla', async () => {
      const foto = await comoVera('post', '/api/fotos')
        .attach('foto', PNG, 'anillo.png')
        .expect(201);
      const { body } = await comoVera('post', '/api/mermas')
        .send({
          sucursal_id: ids.lam,
          variante_id: pieza.anillo,
          cantidad: 2,
          motivo: ' Se quebraron al exhibirlos ',
          foto_url: foto.body.foto_url,
        })
        .expect(201);
      const merma = body.merma as Merma;
      propio.merma = merma.id;
      expect(merma).toEqual({
        id: expect.any(Number),
        sucursal: { id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
        variante: { id: pieza.anillo, sku: 'INV-B5-ANI', nombre: 'Anillo B5 — Anillo liso' },
        cantidad: 2,
        valor_costo: null, // la vendedora no ve costos
        motivo: 'Se quebraron al exhibirlos',
        foto_url: foto.body.foto_url,
        estado: 'PENDIENTE',
        reportada_por: { id: ids.vera, nombre_completo: 'Vera Inventario' },
        reportada_at: expect.any(String),
        resuelta_por: null,
        resuelta_at: null,
        comentario: null,
      });
      expect(await stock(ids.lam, pieza.anillo)).toBe(6); // sigue igual hasta que el admin apruebe
    });

    it('datos inválidos → 400; reglas de la base con su mensaje', async () => {
      const base = {
        sucursal_id: ids.lam,
        variante_id: pieza.anillo,
        cantidad: 1,
        motivo: 'Se perdió',
      };
      const corto = await comoVera('post', '/api/mermas')
        .send({ ...base, motivo: 'rota', foto_url: 'javascript:alert(1)' })
        .expect(400);
      expect(corto.body.errores.map((e: { campo: string }) => e.campo)).toEqual([
        'motivo',
        'foto_url',
      ]);
      await comoVera('post', '/api/mermas')
        .send({ ...base, cantidad: 99 })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'No hay 99 unidad(es) de "Anillo B5 — Anillo liso" en esta ubicación (hay 6)',
        });
      await comoVera('post', '/api/mermas')
        .send({ ...base, sucursal_id: ids.lbr })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: `El usuario ${ids.vera} no está asignado a la sucursal ${ids.lbr}`,
        });
      await comoVera('post', '/api/mermas')
        .send({ ...base, variante_id: ids.servicio })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: 'Solo se reportan mermas de piezas y artículos con stock',
        });
    });

    it('GET /api/mermas: el admin ve las pendientes con lo que cuestan; la base le avisó', async () => {
      const { body } = await comoJefa('get', '/api/mermas?estado=pendiente').expect(200);
      expect((body.mermas as Merma[]).find((m) => m.id === propio.merma)).toMatchObject({
        cantidad: 2,
        valor_costo: '178.44', // 2 × C$89.22
        estado: 'PENDIENTE',
      });
      const alertas = await comoJefa('get', '/api/alertas?tipo=MERMA_PENDIENTE&limite=1').expect(
        200,
      );
      expect((alertas.body.alertas as AlertaAdmin[])[0]).toMatchObject({
        titulo: 'Merma por aprobar: 2 × Anillo B5 — Anillo liso',
        detalle: { merma_id: propio.merma },
        atendida_at: null,
      });
    });

    it('POST /api/mermas/:id/resolver: solo el admin aprueba, y al aprobar se descuenta', async () => {
      await comoVera('post', `/api/mermas/${propio.merma}/resolver`)
        .send({ aprobar: true })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: 'Permiso denegado: se requiere INVENTARIO_AJUSTAR',
        });
      const { body } = await comoJefa('post', `/api/mermas/${propio.merma}/resolver`)
        .send({ aprobar: true, comentario: 'Vista en la foto' })
        .expect(200);
      expect(body.merma).toMatchObject({
        estado: 'APROBADA',
        resuelta_por: { id: ids.jefa, nombre_completo: 'Jefa de inventario' },
        resuelta_at: expect.any(String),
        comentario: 'Vista en la foto',
      });
      expect(await stock(ids.lam, pieza.anillo)).toBe(4);
      const kardex = await movimientos(jefa.acceso, `?variante_id=${pieza.anillo}&tipo=MERMA`);
      expect(kardex.map((m) => [m.cantidad, m.stock_resultante, m.motivo])).toEqual([
        [-2, 4, `Merma #${propio.merma}: Se quebraron al exhibirlos`],
      ]);
      // la alerta quedó atendida
      const alertas = await comoJefa('get', '/api/alertas?tipo=MERMA_PENDIENTE').expect(200);
      expect(
        (alertas.body.alertas as AlertaAdmin[]).some(
          (a) => (a.detalle as { merma_id?: number }).merma_id === propio.merma,
        ),
      ).toBe(false);
    });

    it('una merma rechazada no descuenta nada; una ya resuelta no se resuelve otra vez', async () => {
      const reportada = await comoVera('post', '/api/mermas')
        .send({ sucursal_id: ids.lam, variante_id: pieza.aro, cantidad: 1, motivo: 'No aparece' })
        .expect(201);
      otra.merma = reportada.body.merma.id;
      const { body } = await comoJefa('post', `/api/mermas/${otra.merma}/resolver`)
        .send({ aprobar: false, comentario: 'Estaba en otra vitrina' })
        .expect(200);
      expect(body.merma).toMatchObject({
        estado: 'RECHAZADA',
        comentario: 'Estaba en otra vitrina',
      });
      expect(await stock(ids.lam, pieza.aro)).toBe(3);

      await comoJefa('post', `/api/mermas/${propio.merma}/resolver`)
        .send({ aprobar: false })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: `La merma ${propio.merma} ya fue aprobada` });
      await comoJefa('post', '/api/mermas/999999/resolver')
        .send({ aprobar: true })
        .expect(422)
        .expect({ codigo: 'REGLA_NEGOCIO', mensaje: 'La merma 999999 no existe' });
      const { body: lista } = await comoVera('get', `/api/mermas?sucursal_id=${ids.lam}`).expect(
        200,
      );
      expect(
        (lista.mermas as Merma[]).filter((m) => [propio.merma, otra.merma].includes(m.id)),
      ).toEqual([
        expect.objectContaining({ id: otra.merma, estado: 'RECHAZADA', valor_costo: null }),
        expect.objectContaining({ id: propio.merma, estado: 'APROBADA', valor_costo: null }),
      ]);
    });
  });

  describe('conteos físicos', () => {
    it('POST /api/conteos abre el conteo de una categoría en la sucursal', async () => {
      const { body } = await comoVera('post', '/api/conteos')
        .send({ sucursal_id: ids.lam, categoria_id: ids.categoria, notas: 'Conteo de anillos' })
        .expect(201);
      const conteo = body.conteo as ConteoDetalle;
      propio.conteo = conteo.id;
      expect(conteo).toEqual({
        id: expect.any(Number),
        sucursal: { id: ids.lam, codigo: 'LAM', nombre: 'Multicentro Las Américas' },
        categoria: { id: ids.categoria, nombre: 'Anillos B5' },
        estado: 'ABIERTO',
        notas: 'Conteo de anillos',
        lineas: 0,
        piezas_contadas: 0,
        iniciado_por: { id: ids.vera, nombre_completo: 'Vera Inventario' },
        iniciado_at: expect.any(String),
        enviado_por: null,
        enviado_at: null,
        aplicado_por: null,
        aplicado_at: null,
        detalle: [],
      });
    });

    it('un solo conteo en curso por ubicación; solo en las sucursales propias (reglas de la base)', async () => {
      await comoVera('post', '/api/conteos').send({ sucursal_id: ids.lam }).expect(422).expect({
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'Ya hay un conteo en curso en esta ubicación',
      });
      await comoVera('post', '/api/conteos')
        .send({ sucursal_id: ids.lbr })
        .expect(403)
        .expect({
          codigo: 'PERMISO_DENEGADO',
          mensaje: `El usuario ${ids.vera} no está asignado a la sucursal ${ids.lbr}`,
        });
    });

    it('POST /api/conteos/:id/registrar: cada escaneo suma una pieza; también se puede fijar el total', async () => {
      const ruta = `/api/conteos/${propio.conteo}/registrar`;
      for (const esperado of [1, 2, 3]) {
        await comoVera('post', ruta)
          .send({ variante_id: pieza.anillo })
          .expect(200)
          .expect({ variante_id: pieza.anillo, cantidad_contada: esperado });
      }
      await comoVera('post', ruta)
        .send({ variante_id: pieza.anillo, cantidad: 5, sumar: false })
        .expect(200)
        .expect({ variante_id: pieza.anillo, cantidad_contada: 5 });
      await comoVera('post', ruta)
        .send({ variante_id: ids.demo })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `La pieza ${ids.demo} no corresponde a este conteo`,
        });
    });

    it('quien cuenta no ve el stock del sistema ni las diferencias (conteo a ciegas)', async () => {
      const { body } = await comoVera('get', `/api/conteos/${propio.conteo}`).expect(200);
      expect((body.conteo as ConteoDetalle).detalle).toEqual([
        {
          variante: { id: pieza.anillo, sku: 'INV-B5-ANI', nombre: 'Anillo B5 — Anillo liso' },
          cantidad_contada: 5,
        },
      ]);
      expect(JSON.stringify(body)).not.toMatch(/stock_sistema|diferencia/);
      await comoVera('get', `/api/conteos/${propio.conteo}/diferencias`).expect(403).expect({
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere INVENTARIO_AJUSTAR',
      });
    });

    it('POST /api/conteos/:id/enviar cierra el escaneo: lo no escaneado cuenta como cero', async () => {
      const { body } = await comoVera('post', `/api/conteos/${propio.conteo}/enviar`).expect(200);
      const conteo = body.conteo as ConteoDetalle;
      expect(conteo).toMatchObject({
        estado: 'ENVIADO',
        lineas: 2,
        piezas_contadas: 5,
        enviado_por: { id: ids.vera, nombre_completo: 'Vera Inventario' },
      });
      expect(conteo.detalle.map((d) => [d.variante.sku, d.cantidad_contada])).toEqual([
        ['INV-B5-ANI', 5],
        ['INV-B5-ARO', 0],
      ]);
      await comoVera('post', `/api/conteos/${propio.conteo}/registrar`)
        .send({ variante_id: pieza.anillo })
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `El conteo ${propio.conteo} no está abierto`,
        });
    });

    it('GET /api/conteos/:id/diferencias: el admin compara lo contado con el sistema', async () => {
      const { body } = await comoJefa('get', `/api/conteos/${propio.conteo}/diferencias`).expect(
        200,
      );
      expect(body.diferencias as DiferenciaConteo[]).toEqual([
        {
          variante: { id: pieza.aro, sku: 'INV-B5-ARO', nombre: 'Anillo B5 — Aro fino' },
          stock_sistema: 3,
          contada: 0,
          diferencia: -3,
          valor_diferencia: '-167.28', // 3 × C$55.76
        },
        {
          variante: { id: pieza.anillo, sku: 'INV-B5-ANI', nombre: 'Anillo B5 — Anillo liso' },
          stock_sistema: 4,
          contada: 5,
          diferencia: 1,
          valor_diferencia: '89.22',
        },
      ]);
    });

    it('POST /api/conteos/:id/aplicar convierte cada diferencia en un ajuste del kardex', async () => {
      await comoVera('post', `/api/conteos/${propio.conteo}/aplicar`).expect(403);
      const { body } = await comoJefa('post', `/api/conteos/${propio.conteo}/aplicar`).expect(200);
      expect(body.ajustes).toBe(2);
      expect(body.conteo).toMatchObject({
        estado: 'APLICADO',
        aplicado_por: { id: ids.jefa, nombre_completo: 'Jefa de inventario' },
        aplicado_at: expect.any(String),
      });
      expect(await stock(ids.lam, pieza.anillo)).toBe(5);
      expect(await stock(ids.lam, pieza.aro)).toBe(0);
      await comoJefa('post', `/api/conteos/${propio.conteo}/aplicar`)
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `El conteo ${propio.conteo} no está listo para aplicar`,
        });

      // El kardex de Vera muestra lo de su sucursal, sin costos; el del admin, todo
      const deVera = await movimientos(vera.acceso, `?variante_id=${pieza.anillo}`);
      expect(deVera.map((m) => [m.tipo, m.cantidad, m.stock_resultante, m.costo_unitario])).toEqual(
        [
          ['AJUSTE_POSITIVO', 1, 5, null],
          ['MERMA', -2, 4, null],
          ['TRASLADO_ENTRADA', 6, 6, null],
        ],
      );
      expect(deVera[0].motivo).toBe(`Conteo físico #${propio.conteo}`);
      expect(deVera[2]).toMatchObject({ envio_id: propio.envio, sucursal: { codigo: 'LAM' } });
      const deLaJefa = await movimientos(jefa.acceso, `?variante_id=${pieza.anillo}`);
      expect(deLaJefa.map((m) => [m.tipo, m.sucursal.codigo, m.cantidad])).toEqual([
        ['AJUSTE_POSITIVO', 'LAM', 1],
        ['MERMA', 'LAM', -2],
        ['TRASLADO_ENTRADA', 'LAM', 6],
        ['TRASLADO_SALIDA', 'BOD', -6],
        ['ENTRADA', 'BOD', 10],
      ]);
    });

    it('POST /api/conteos/:id/cancelar descarta un conteo en curso', async () => {
      const nuevo = await comoVera('post', '/api/conteos')
        .send({ sucursal_id: ids.lam, categoria_id: ids.categoria })
        .expect(201);
      const { body } = await comoVera(
        'post',
        `/api/conteos/${nuevo.body.conteo.id}/cancelar`,
      ).expect(200);
      expect(body.conteo.estado).toBe('CANCELADO');
      await comoVera('post', `/api/conteos/${nuevo.body.conteo.id}/cancelar`)
        .expect(422)
        .expect({
          codigo: 'REGLA_NEGOCIO',
          mensaje: `El conteo ${nuevo.body.conteo.id} ya está cerrado`,
        });
      expect(await stock(ids.lam, pieza.anillo)).toBe(5); // cancelar no mueve nada
    });

    it('GET /api/conteos lista los de las sucursales del usuario; conteo inexistente → 404', async () => {
      const { body } = await comoVera('get', `/api/conteos?sucursal_id=${ids.lam}&limite=2`).expect(
        200,
      );
      expect((body.conteos as ConteoDetalle[]).map((c) => [c.estado, c.sucursal.codigo])).toEqual([
        ['CANCELADO', 'LAM'],
        ['APLICADO', 'LAM'],
      ]);
      const aplicados = await comoJefa('get', '/api/conteos?estado=aplicado').expect(200);
      expect((aplicados.body.conteos as ConteoDetalle[]).map((c) => c.id)).toContain(propio.conteo);
      await comoJefa('get', '/api/conteos/999999').expect(404).expect({
        codigo: 'NO_ENCONTRADO',
        mensaje: 'El conteo 999999 no existe',
      });
      await comoJefa('post', '/api/conteos/999999/cancelar').expect(404);
    });
  });
});
