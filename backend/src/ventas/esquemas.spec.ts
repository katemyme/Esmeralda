import type { z } from 'zod';
import { esquemaFiltroVentas, esquemaRegistrarVenta } from './esquemas';

const CLAVE = '6f1c0f6e-3b1a-4a3e-9d55-0c4b8f0f1a11';

function mensajes(esquema: z.ZodType, datos: unknown): Record<string, string> {
  const resultado = esquema.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );
}

describe('esquemaRegistrarVenta', () => {
  it('lo mínimo: la clave, un producto y un pago (en córdobas si no se dice)', () => {
    expect(
      esquemaRegistrarVenta.parse({
        clave_idempotencia: CLAVE,
        items: [{ variante_id: 12, cantidad: 1 }],
        pagos: [{ metodo: ' efectivo ', monto: 650.5 }],
      }),
    ).toEqual({
      clave_idempotencia: CLAVE,
      items: [{ variante_id: 12, cantidad: 1 }],
      pagos: [{ metodo: 'EFECTIVO', moneda: 'NIO', monto: '650.5', referencia: null }],
      promocion_id: null,
      cliente_nombre: null,
      cliente_telefono: null,
      notas: null,
    });
  });

  it('la venta no lleva sucursal, turno ni vendedor: si la pantalla los manda, se descartan', () => {
    const datos = esquemaRegistrarVenta.parse({
      clave_idempotencia: CLAVE,
      items: [{ variante_id: 12, cantidad: 1, costo: 1, precio_lista: 1 }],
      pagos: [{ metodo: 'EFECTIVO', monto: 650, tipo_cambio: 1, es_vuelto: true }],
      sucursal_id: 2,
      turno_id: 99,
      vendedor_id: 1,
      numero: 'LAM-00000001',
      total: 1,
    });
    expect(Object.keys(datos).sort()).toEqual([
      'clave_idempotencia',
      'cliente_nombre',
      'cliente_telefono',
      'items',
      'notas',
      'pagos',
      'promocion_id',
    ]);
    expect(datos.items[0]).toEqual({ variante_id: 12, cantidad: 1 });
    expect(Object.keys(datos.pagos[0]).sort()).toEqual(['metodo', 'moneda', 'monto', 'referencia']);
  });

  it('paquete con sus piezas, precio subido, pago en dólares, promoción y caja elegida', () => {
    expect(
      esquemaRegistrarVenta.parse({
        clave_idempotencia: CLAVE,
        items: [{ variante_id: 40, cantidad: 1, precio: '1100.00', piezas: [21, 21] }],
        pagos: [
          { metodo: 'EFECTIVO', moneda: 'usd', monto: '20' },
          { metodo: 'tarjeta', monto: 367.52, referencia: ' 784512 ' },
        ],
        promocion_id: 3,
        cliente_nombre: ' Ana ',
        notas: '',
        caja_id: 2,
      }),
    ).toMatchObject({
      items: [{ variante_id: 40, cantidad: 1, precio: '1100.00', piezas: [21, 21] }],
      pagos: [
        { metodo: 'EFECTIVO', moneda: 'USD', monto: '20', referencia: null },
        { metodo: 'TARJETA', moneda: 'NIO', monto: '367.52', referencia: '784512' },
      ],
      promocion_id: 3,
      cliente_nombre: 'Ana',
      notas: null,
      caja_id: 2,
    });
  });

  it('mensajes en español por campo', () => {
    expect(mensajes(esquemaRegistrarVenta, {})).toEqual({
      clave_idempotencia: 'clave_idempotencia debe ser un UUID que el POS genera para cada venta',
      items: 'Envíe los productos en "items": [{ variante_id, cantidad }]',
      pagos: 'Envíe los pagos en "pagos": [{ metodo, moneda, monto }]',
    });
    expect(
      mensajes(esquemaRegistrarVenta, {
        clave_idempotencia: 'venta-1',
        items: [{ variante_id: 0, cantidad: 1.5, precio: '10.999', piezas: ['aro'] }],
        pagos: [{ metodo: 'EFECTIVO', moneda: 'EUR', monto: 0, referencia: 'x'.repeat(61) }],
        promocion_id: 'diez',
        caja_id: -1,
      }),
    ).toEqual({
      clave_idempotencia: 'clave_idempotencia debe ser un UUID que el POS genera para cada venta',
      'items.0.variante_id': 'Indique el producto (variante_id)',
      'items.0.cantidad': 'La cantidad debe ser un entero de 1 en adelante',
      'items.0.precio': 'El precio debe ser un monto de 0 en adelante, con 2 decimales como máximo',
      'items.0.piezas.0':
        'Envíe en "piezas" los ids de las piezas escaneadas del paquete (de 1 a 10)',
      'pagos.0.moneda': 'La moneda debe ser NIO o USD',
      'pagos.0.monto': 'El monto de cada pago debe ser mayor que 0, con 2 decimales como máximo',
      'pagos.0.referencia': 'La referencia es demasiado larga',
      promocion_id: 'promocion_id debe ser el id de una promoción',
      caja_id: 'caja_id debe ser el id de una caja',
    });
    expect(
      mensajes(esquemaRegistrarVenta, { clave_idempotencia: CLAVE, items: [], pagos: [] }),
    ).toEqual({
      items: 'La venta debe tener al menos un producto',
      pagos: 'La venta debe tener al menos un pago',
    });
  });
});

describe('esquemaFiltroVentas', () => {
  it('sin filtros: 50 ventas; con filtros, los convierte', () => {
    expect(esquemaFiltroVentas.parse({})).toEqual({ limite: 50 });
    expect(
      esquemaFiltroVentas.parse({
        sucursal_id: '2',
        turno_id: '7',
        vendedor_id: '3',
        estado: 'anulada',
        desde: '2026-10-01',
        hasta: '2026-10-07',
        buscar: ' lam-0001 ',
        limite: '20',
        antes_de: '300',
      }),
    ).toEqual({
      sucursal_id: 2,
      turno_id: 7,
      vendedor_id: 3,
      estado: 'ANULADA',
      desde: '2026-10-01',
      hasta: '2026-10-07',
      buscar: 'lam-0001',
      limite: 20,
      antes_de: 300,
    });
    expect(esquemaFiltroVentas.parse({ buscar: '  ' })).toEqual({ limite: 50 });
  });

  it('mensajes por campo', () => {
    expect(
      mensajes(esquemaFiltroVentas, { estado: 'borrada', desde: '01/10/2026', limite: '500' }),
    ).toEqual({
      estado: 'estado debe ser COMPLETADA o ANULADA',
      desde: 'desde debe ser una fecha con el formato AAAA-MM-DD',
      limite: 'limite debe ser un número entre 1 y 200',
    });
  });
});
