import { describe, expect, it, vi } from 'vitest';
import type { MetodoPago, VarianteEncontrada } from '../api/tipos';
import { dolaresACordobas, nuevoUuid } from '../util/dinero';
import {
  agregar,
  agregarPaquete,
  cambiarCantidad,
  cambiarPrecio,
  cuenta,
  enCordobas,
  itemsDeVenta,
  nombreDe,
  nuevoPago,
  pagosDeVenta,
  quedan,
  quitar,
  subtotal,
  unidadesEnCarrito,
  type Linea,
} from './carrito';

const variante = (datos: Partial<VarianteEncontrada>): VarianteEncontrada => ({
  id: 1,
  sku: 'X',
  codigo_barras: null,
  producto: 'Producto',
  variante: 'Única',
  categoria: 'Categoría',
  tipo: 'PRODUCTO',
  precio: '100.00',
  stock: 10,
  gama: null,
  ...datos,
});

const ARO = variante({
  id: 7,
  sku: 'ACE-ARO-16-8',
  producto: 'Aro acero',
  variante: '8 mm',
  precio: '230.00',
  stock: 3,
});
const LABRET = variante({
  id: 5,
  sku: 'TIT-LAB-16-6',
  producto: 'Labret titanio',
  variante: '6 mm',
  precio: '650.00',
  stock: 2,
  gama: 'Titanio',
});
const LOBULO = variante({
  id: 20,
  sku: 'SRV-LOB',
  producto: 'Perforación Lóbulo',
  tipo: 'SERVICIO',
  precio: '300.00',
  stock: null,
});
const PAQUETE = variante({
  id: 21,
  sku: 'PAQ-LOB',
  producto: 'Perforación Lóbulo con pieza',
  tipo: 'PAQUETE',
  precio: null,
  stock: null,
});

const METODOS: MetodoPago[] = [
  { codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true, requiere_referencia: false },
  { codigo: 'TARJETA', nombre: 'Tarjeta', es_efectivo: false, requiere_referencia: true },
];
const TC = '36.6243';

describe('el carrito', () => {
  it('agregar lo mismo otra vez suma una unidad; otro producto es otro renglón', () => {
    let lineas: Linea[] = [];
    lineas = agregar(lineas, ARO);
    lineas = agregar(lineas, ARO);
    lineas = agregar(lineas, LOBULO);
    expect(lineas.map((l) => [l.variante.sku, l.cantidad])).toEqual([
      ['ACE-ARO-16-8', 2],
      ['SRV-LOB', 1],
    ]);
    expect(subtotal(lineas)).toBe(2 * 23000 + 30000);
    expect(nombreDe(ARO)).toBe('Aro acero — 8 mm');
    expect(nombreDe(LOBULO)).toBe('Perforación Lóbulo');
  });

  it('una perforación con pieza es un renglón aparte, de una unidad, con el precio que dio la API', () => {
    let lineas = agregarPaquete([], PAQUETE, [LABRET], '850.00');
    lineas = agregarPaquete(lineas, PAQUETE, [LABRET], '850.00');
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatchObject({ cantidad: 1, lista: 85000, precio: 85000 });
    expect(itemsDeVenta(lineas)).toEqual([
      { variante_id: 21, cantidad: 1, piezas: [5] },
      { variante_id: 21, cantidad: 1, piezas: [5] },
    ]);
  });

  it('las existencias cuentan lo suelto y lo que va dentro de un paquete', () => {
    let lineas = agregar([], LABRET);
    expect(quedan(lineas, LABRET)).toBe(true); // hay 2 y va 1
    lineas = agregarPaquete(lineas, PAQUETE, [LABRET], '850.00');
    expect(unidadesEnCarrito(lineas, LABRET.id)).toBe(2);
    expect(quedan(lineas, LABRET)).toBe(false);
    // lo que no lleva existencias (un servicio) nunca se acaba
    expect(quedan(agregar(lineas, LOBULO), LOBULO)).toBe(true);
  });

  it('cambiar la cantidad a cero quita el renglón', () => {
    const lineas = agregar(agregar([], ARO), LOBULO);
    const [aro] = lineas;
    expect(cambiarCantidad(lineas, aro.clave, 3)[0].cantidad).toBe(3);
    expect(cambiarCantidad(lineas, aro.clave, 0).map((l) => l.variante.sku)).toEqual(['SRV-LOB']);
    expect(quitar(lineas, aro.clave)).toHaveLength(1);
  });

  it('el precio solo sube: por debajo del establecido se queda en el establecido', () => {
    const lineas = agregar([], ARO);
    const clave = lineas[0].clave;
    const subido = cambiarPrecio(lineas, clave, 30000);
    expect(subido[0]).toMatchObject({ lista: 23000, precio: 30000 });
    expect(cambiarPrecio(lineas, clave, 10000)[0].precio).toBe(23000);
    // el precio solo viaja a la API cuando se cobra más
    expect(itemsDeVenta(subido)).toEqual([{ variante_id: 7, cantidad: 1, precio: '300.00' }]);
    expect(itemsDeVenta(lineas)).toEqual([{ variante_id: 7, cantidad: 1 }]);
    // y con el precio cambiado, agregar otro igual es un renglón nuevo, al precio establecido
    expect(agregar(subido, ARO).map((l) => l.precio)).toEqual([30000, 23000]);
  });
});

describe('los dólares, al tipo de cambio del día', () => {
  it('se convierten con el redondeo de la base, sin perder centavos', () => {
    expect(dolaresACordobas(2000, TC)).toBe(73249); // US$ 20.00 × 36.6243 = 732.486 → 732.49
    expect(dolaresACordobas(100, '36.6250')).toBe(3663); // 36.625 → 36.63 (el medio sube)
    expect(dolaresACordobas(1, '36.62')).toBe(37);
    expect(dolaresACordobas(0, TC)).toBe(0);
  });

  it('un pago vale lo suyo en córdobas, o nada si no es un monto', () => {
    expect(enCordobas(nuevoPago('EFECTIVO', 'NIO', '1000'), TC)).toBe(100000);
    expect(enCordobas(nuevoPago('EFECTIVO', 'USD', '20'), TC)).toBe(73249);
    expect(enCordobas(nuevoPago('EFECTIVO', 'USD', '20'), null)).toBeNull(); // sin tipo de cambio de hoy
    for (const malo of ['', '0', 'mil', '10.999', '-5']) {
      expect(enCordobas(nuevoPago('EFECTIVO', 'NIO', malo), TC)).toBeNull();
    }
  });
});

describe('la cuenta del cobro', () => {
  const TOTAL = 99900; // C$ 999.00

  it('efectivo de más: lo que sobra es el vuelto', () => {
    const c = cuenta(TOTAL, [nuevoPago('EFECTIVO', 'NIO', '1000')], METODOS, TC);
    expect(c).toEqual({ pagado: 100000, falta: 0, vuelto: 100, pendiente: null });
  });

  it('pago mixto en dólares y tarjeta, con vuelto en córdobas', () => {
    const tarjeta = { ...nuevoPago('TARJETA', 'NIO', '300'), referencia: '784512' };
    const c = cuenta(TOTAL, [nuevoPago('EFECTIVO', 'USD', '20'), tarjeta], METODOS, TC);
    expect(c).toEqual({ pagado: 103249, falta: 0, vuelto: 3349, pendiente: null });
  });

  it('mientras falte dinero, o falte un dato, la venta no se puede registrar', () => {
    expect(cuenta(TOTAL, [nuevoPago('EFECTIVO', 'NIO', '500')], METODOS, TC)).toMatchObject({
      falta: 49900,
      vuelto: 0,
      pendiente: 'Lo pagado todavía no cubre el total.',
    });
    expect(cuenta(TOTAL, [nuevoPago('EFECTIVO')], METODOS, TC).pendiente).toMatch(
      /monto de cada pago/,
    );
    expect(cuenta(TOTAL, [], METODOS, TC).pendiente).toBe('Agregue al menos un pago.');
    // la tarjeta pide su referencia
    expect(cuenta(TOTAL, [nuevoPago('TARJETA', 'NIO', '999')], METODOS, TC).pendiente).toMatch(
      /referencia del pago con tarjeta/,
    );
    // y los dólares, el tipo de cambio de hoy
    expect(cuenta(TOTAL, [nuevoPago('EFECTIVO', 'USD', '30')], METODOS, null).pendiente).toMatch(
      /tipo de cambio de hoy/,
    );
  });

  it('con tarjeta no hay vuelto: no puede pasar del total', () => {
    const demas = { ...nuevoPago('TARJETA', 'NIO', '1200'), referencia: '1' };
    expect(cuenta(TOTAL, [demas], METODOS, TC)).toMatchObject({
      vuelto: 0,
      pendiente: 'Lo pagado con tarjeta o transferencia pasa del total: corrija el monto.',
    });
    // pero si el exceso se cubre con el efectivo entregado, sí: es vuelto
    const tarjeta = { ...nuevoPago('TARJETA', 'NIO', '900'), referencia: '1' };
    expect(
      cuenta(TOTAL, [tarjeta, nuevoPago('EFECTIVO', 'NIO', '200')], METODOS, TC),
    ).toMatchObject({
      vuelto: 10100,
      pendiente: null,
    });
  });

  it('los pagos viajan como los escribió la persona, sin referencias vacías', () => {
    const tarjeta = { ...nuevoPago('TARJETA', 'NIO', ' 300 '), referencia: ' 784512 ' };
    expect(pagosDeVenta([nuevoPago('EFECTIVO', 'USD', '20'), tarjeta])).toEqual([
      { metodo: 'EFECTIVO', moneda: 'USD', monto: '20' },
      { metodo: 'TARJETA', moneda: 'NIO', monto: '300', referencia: '784512' },
    ]);
  });
});

describe('la clave de cada venta', () => {
  it('es un UUID distinto cada vez, también donde no existe crypto.randomUUID', () => {
    const formato = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(nuevoUuid()).toMatch(formato);
    const real = globalThis.crypto;
    // un navegador fuera de https: tiene números al azar, pero no randomUUID
    vi.stubGlobal('crypto', {
      getRandomValues: (destino: Uint8Array<ArrayBuffer>) => real.getRandomValues(destino),
    });
    try {
      const [a, b] = [nuevoUuid(), nuevoUuid()];
      expect(a).toMatch(formato);
      expect(a).not.toBe(b);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
