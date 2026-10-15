import type { MetodoPago, VarianteEncontrada } from '../api/tipos';
import { aCentavos, deCentavos, dolaresACordobas, esMonto } from '../util/dinero';

// Las cuentas de la venta en pantalla, siempre en centavos enteros. Las reglas son de la base
// (precio de lista, promoción, vuelto, existencias): aquí solo se suma lo que va en el carrito y lo
// que la clienta entrega, para mostrar el total y el vuelto antes de registrar la venta.

export interface Linea {
  /** Identifica el renglón en el carrito. */
  clave: string;
  variante: VarianteEncontrada;
  cantidad: number;
  /** Precio establecido de la unidad (el de un paquete lo da la API según sus piezas). */
  lista: number;
  /** Lo que se cobra por unidad: igual o mayor que el establecido, nunca menor. */
  precio: number;
  /** Solo en una perforación con pieza: las piezas que se lleva. */
  piezas: VarianteEncontrada[];
}

export type Moneda = 'NIO' | 'USD';

export interface Pago {
  clave: string;
  metodo: string;
  moneda: Moneda;
  /** Tal como lo escribe la persona. */
  monto: string;
  referencia: string;
}

/** «Labret titanio — 6 mm»; si el producto tiene una sola presentación, solo su nombre. */
export function nombreDe(variante: VarianteEncontrada): string {
  return variante.variante === 'Única'
    ? variante.producto
    : `${variante.producto} — ${variante.variante}`;
}

let correlativo = 0;
const nuevaClave = () => `r${++correlativo}`;

/** Agrega una pieza o un servicio. Si ya está en el carrito (al precio establecido), suma una. */
export function agregar(lineas: Linea[], variante: VarianteEncontrada): Linea[] {
  const lista = aCentavos(variante.precio ?? 0);
  const igual = lineas.find(
    (l) => l.variante.id === variante.id && l.piezas.length === 0 && l.precio === l.lista,
  );
  if (igual) return cambiarCantidad(lineas, igual.clave, igual.cantidad + 1);
  return [
    ...lineas,
    { clave: nuevaClave(), variante, cantidad: 1, lista, precio: lista, piezas: [] },
  ];
}

/** Una perforación con pieza: siempre un renglón aparte, de una unidad, con sus piezas. */
export function agregarPaquete(
  lineas: Linea[],
  variante: VarianteEncontrada,
  piezas: VarianteEncontrada[],
  precio: string,
): Linea[] {
  const lista = aCentavos(precio);
  return [...lineas, { clave: nuevaClave(), variante, cantidad: 1, lista, precio: lista, piezas }];
}

/** Cuántas unidades de esa pieza hay ya en el carrito, sueltas o dentro de un paquete. */
export function unidadesEnCarrito(lineas: Linea[], varianteId: number): number {
  return lineas.reduce(
    (suma, l) =>
      suma +
      (l.variante.id === varianteId ? l.cantidad : 0) +
      l.piezas.filter((p) => p.id === varianteId).length,
    0,
  );
}

/** ¿Queda alguna más para vender? Lo que no lleva existencias (servicios, paquetes), siempre. */
export function quedan(lineas: Linea[], variante: VarianteEncontrada): boolean {
  return variante.stock === null || unidadesEnCarrito(lineas, variante.id) < variante.stock;
}

export function cambiarCantidad(lineas: Linea[], clave: string, cantidad: number): Linea[] {
  if (cantidad <= 0) return quitar(lineas, clave);
  return lineas.map((l) => (l.clave === clave ? { ...l, cantidad } : l));
}

/** Cobrar más por la unidad. Por debajo del precio establecido no se puede: se queda en él. */
export function cambiarPrecio(lineas: Linea[], clave: string, precio: number): Linea[] {
  return lineas.map((l) => (l.clave === clave ? { ...l, precio: Math.max(precio, l.lista) } : l));
}

export function quitar(lineas: Linea[], clave: string): Linea[] {
  return lineas.filter((l) => l.clave !== clave);
}

export function subtotal(lineas: Linea[]): number {
  return lineas.reduce((suma, l) => suma + l.cantidad * l.precio, 0);
}

/** Las líneas como las espera `POST /api/ventas`: el precio solo viaja cuando se cobra más. */
export function itemsDeVenta(lineas: Linea[]) {
  return lineas.map((l) => ({
    variante_id: l.variante.id,
    cantidad: l.cantidad,
    ...(l.precio > l.lista ? { precio: deCentavos(l.precio) } : {}),
    ...(l.piezas.length > 0 ? { piezas: l.piezas.map((p) => p.id) } : {}),
  }));
}

export function nuevoPago(metodo: string, moneda: Moneda = 'NIO', monto = ''): Pago {
  return { clave: nuevaClave(), metodo, moneda, monto, referencia: '' };
}

/** Lo que vale un pago en córdobas (los dólares, al tipo de cambio vigente); null si no es un monto. */
export function enCordobas(pago: Pago, usdANio: string | null): number | null {
  if (!esMonto(pago.monto) || aCentavos(pago.monto) <= 0) return null;
  if (pago.moneda === 'NIO') return aCentavos(pago.monto);
  return usdANio === null ? null : dolaresACordobas(aCentavos(pago.monto), usdANio);
}

export interface Cuenta {
  /** Todo lo entregado, en córdobas. */
  pagado: number;
  /** Lo que todavía falta para cubrir el total (0 si ya alcanza). */
  falta: number;
  /** Lo que se devuelve en efectivo, en córdobas. */
  vuelto: number;
  /** Por qué todavía no se puede registrar la venta; null si todo está bien. */
  pendiente: string | null;
}

/**
 * Cuánto se ha pagado, cuánto falta y cuánto se da de vuelto. Las mismas reglas de la base: lo
 * pagado debe cubrir el total, y solo el efectivo puede pasarse (lo que sobra es el vuelto).
 */
export function cuenta(
  total: number,
  pagos: Pago[],
  metodos: MetodoPago[],
  usdANio: string | null,
): Cuenta {
  let pagado = 0;
  let efectivo = 0;
  let pendiente: string | null = null;
  for (const pago of pagos) {
    const metodo = metodos.find((m) => m.codigo === pago.metodo);
    const valor = enCordobas(pago, usdANio);
    if (valor === null) {
      pendiente ??=
        pago.moneda === 'USD' && usdANio === null
          ? 'No hay tipo de cambio para cobrar en dólares.'
          : 'Escriba el monto de cada pago (solo números, por ejemplo 1500.50).';
      continue;
    }
    if (metodo?.requiere_referencia && !pago.referencia.trim()) {
      pendiente ??= `Escriba el número de referencia del pago con ${metodo.nombre.toLowerCase()}.`;
    }
    pagado += valor;
    if (metodo?.es_efectivo) efectivo += valor;
  }
  const falta = Math.max(total - pagado, 0);
  const sobra = Math.max(pagado - total, 0);
  if (pagos.length === 0) pendiente ??= 'Agregue al menos un pago.';
  if (falta > 0) pendiente ??= 'Lo pagado todavía no cubre el total.';
  if (sobra > efectivo) {
    pendiente ??= 'Lo pagado con tarjeta o transferencia pasa del total: corrija el monto.';
  }
  return { pagado, falta, vuelto: sobra > efectivo ? 0 : sobra, pendiente };
}

/** Los pagos como los espera `POST /api/ventas`. */
export function pagosDeVenta(pagos: Pago[]) {
  return pagos.map((p) => ({
    metodo: p.metodo,
    moneda: p.moneda,
    monto: p.monto.trim(),
    ...(p.referencia.trim() ? { referencia: p.referencia.trim() } : {}),
  }));
}
