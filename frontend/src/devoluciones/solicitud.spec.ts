import { describe, expect, it } from 'vitest';
import type { LineaDevoluble, VentaParaDevolver } from '../api/tipos';
import {
  lineasDeSolicitud,
  montoAproximado,
  numeroDeFactura,
  pedir,
  pendienteDeSolicitud,
  seDevuelve,
  unidades,
  type Pedidos,
} from './solicitud';

function linea(parcial: Partial<LineaDevoluble>): LineaDevoluble {
  return {
    detalle_id: 101,
    variante: { id: 7, sku: 'JOY-CAD', nombre: 'Cadena plata — 45 cm' },
    categoria: 'Joyería',
    cantidad: 3,
    devuelta: 0,
    apartada: 0,
    disponible: 3,
    monto_unitario: '333.33',
    admite: true,
    motivo_no: null,
    ...parcial,
  };
}

const CADENAS = linea({});
const PERFUME = linea({ detalle_id: 102, cantidad: 1, disponible: 1, monto_unitario: '400.00' });
const LABRET = linea({
  detalle_id: 103,
  admite: false,
  motivo_no: 'La categoría "Piezas de titanio" no admite devoluciones',
});

describe('número de factura', () => {
  it('vale lo que trae el QR y lo que se escribe corto, con o sin guion', () => {
    expect(numeroDeFactura('LAM-00000012')).toBe('LAM-00000012');
    expect(numeroDeFactura(' lam-12 ')).toBe('LAM-00000012');
    expect(numeroDeFactura('lam 12')).toBe('LAM-00000012');
    expect(numeroDeFactura('lbr7')).toBe('LBR-00000007');
  });

  it('solo el correlativo vale cuando se sabe de qué sucursal se habla', () => {
    expect(numeroDeFactura('12', 'LAM')).toBe('LAM-00000012');
    expect(numeroDeFactura('12')).toBeNull();
    expect(numeroDeFactura('12', null)).toBeNull();
  });

  it('lo que no es un número de factura no pasa (el código de un producto, texto suelto)', () => {
    expect(numeroDeFactura('PTI-00001-X', 'LAM')).toBeNull();
    expect(numeroDeFactura('cadena', 'LAM')).toBeNull();
    expect(numeroDeFactura('', 'LAM')).toBeNull();
    expect(numeroDeFactura('LAM-123456789')).toBeNull(); // más de 8 dígitos
  });
});

describe('lo que se pide de cada línea', () => {
  it('no pasa de lo que queda por devolver, ni cuenta más defectuosas que unidades', () => {
    let pedidos: Pedidos = {};
    pedidos = pedir(pedidos, CADENAS, { cantidad: 5 });
    expect(pedidos[101]).toEqual({ cantidad: 3, defectuosas: 0 });
    pedidos = pedir(pedidos, CADENAS, { defectuosas: 9 });
    expect(pedidos[101]).toEqual({ cantidad: 3, defectuosas: 3 });
    // al bajar la cantidad bajan también las defectuosas
    pedidos = pedir(pedidos, CADENAS, { cantidad: 1 });
    expect(pedidos[101]).toEqual({ cantidad: 1, defectuosas: 1 });
    pedidos = pedir(pedidos, CADENAS, { cantidad: -2 });
    expect(pedidos[101]).toEqual({ cantidad: 0, defectuosas: 0 });
  });

  it('de lo que no admite devolución, o ya está en otra solicitud, no se pide nada', () => {
    expect(seDevuelve(LABRET)).toBe(false);
    expect(seDevuelve(linea({ disponible: 0 }))).toBe(false);
    expect(pedir({}, LABRET, { cantidad: 1 })[103]).toEqual({ cantidad: 0, defectuosas: 0 });
  });

  it('a la API lo bueno y lo defectuoso van aparte, y lo que quedó en cero no va', () => {
    let pedidos: Pedidos = {};
    pedidos = pedir(pedidos, CADENAS, { cantidad: 3, defectuosas: 1 });
    pedidos = pedir(pedidos, PERFUME, { cantidad: 1, defectuosas: 1 });
    pedidos = pedir(pedidos, LABRET, { cantidad: 1 });
    expect(unidades(pedidos)).toBe(4);
    expect(lineasDeSolicitud(pedidos)).toEqual([
      { detalle_id: 101, cantidad: 2, estado: 'BUENO' },
      { detalle_id: 101, cantidad: 1, estado: 'DEFECTUOSO' },
      { detalle_id: 102, cantidad: 1, estado: 'DEFECTUOSO' },
    ]);
  });

  it('el monto aproximado es lo pagado por cada unidad pedida, en centavos', () => {
    const venta = { lineas: [CADENAS, PERFUME, LABRET] } as VentaParaDevolver;
    let pedidos: Pedidos = {};
    expect(montoAproximado(venta, pedidos)).toBe(0);
    pedidos = pedir(pedidos, CADENAS, { cantidad: 2 });
    pedidos = pedir(pedidos, PERFUME, { cantidad: 1 });
    expect(montoAproximado(venta, pedidos)).toBe(66_666 + 40_000);
  });
});

describe('qué falta para enviar la solicitud', () => {
  const completa = {
    tipo: 'DEVOLUCION' as const,
    pedidos: pedir({}, PERFUME, { cantidad: 1 }),
    motivo: 'No le gustó el aroma',
    nombre: 'Carla Cliente',
    telefono: '8888-1234',
    pideSucursal: false,
    sucursalId: null,
  };

  it('lo dice en orden, una cosa a la vez; completa, nada', () => {
    expect(pendienteDeSolicitud({ ...completa, tipo: null })).toMatch(/devolución o un cambio/);
    expect(pendienteDeSolicitud({ ...completa, pedidos: {} })).toMatch(/lo que devuelve/);
    expect(pendienteDeSolicitud({ ...completa, motivo: ' no ' })).toMatch(/motivo/);
    expect(pendienteDeSolicitud({ ...completa, nombre: 'Al' })).toMatch(/nombre del cliente/);
    expect(pendienteDeSolicitud({ ...completa, telefono: '8888' })).toMatch(/teléfono/);
    expect(pendienteDeSolicitud(completa)).toBeNull();
  });

  it('quien tiene que decir la sucursal no envía sin elegirla', () => {
    expect(pendienteDeSolicitud({ ...completa, pideSucursal: true })).toMatch(/sucursal/);
    expect(pendienteDeSolicitud({ ...completa, pideSucursal: true, sucursalId: 2 })).toBeNull();
  });
});
