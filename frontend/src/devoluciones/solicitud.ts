import type { LineaDevoluble, VentaParaDevolver } from '../api/tipos';
import { aCentavos } from '../util/dinero';

// La solicitud de una devolución o de un cambio, sin React. Qué se puede devolver, cuánto vale y el
// plazo son de la base: aquí solo se arma lo que la persona marca y se dice qué falta para enviarlo.

/** Lo que se devuelve de una línea de la factura: cuántas unidades y, de esas, cuántas defectuosas. */
export interface Pedido {
  cantidad: number;
  defectuosas: number;
}

/** Lo pedido de cada línea, por su `detalle_id`. */
export type Pedidos = Record<number, Pedido>;

const entre = (n: number, minimo: number, maximo: number) =>
  Math.min(Math.max(Math.trunc(n) || 0, minimo), maximo);

/** ¿Queda algo de esta línea que se pueda pedir? */
export function seDevuelve(linea: LineaDevoluble): boolean {
  return linea.admite && linea.disponible > 0;
}

/**
 * Cambia lo pedido de una línea, sin pasar de lo que queda por devolver ni contar más defectuosas
 * que unidades pedidas.
 */
export function pedir(pedidos: Pedidos, linea: LineaDevoluble, cambio: Partial<Pedido>): Pedidos {
  const actual = pedidos[linea.detalle_id] ?? { cantidad: 0, defectuosas: 0 };
  const tope = seDevuelve(linea) ? linea.disponible : 0;
  const cantidad = entre(cambio.cantidad ?? actual.cantidad, 0, tope);
  const defectuosas = entre(cambio.defectuosas ?? actual.defectuosas, 0, cantidad);
  return { ...pedidos, [linea.detalle_id]: { cantidad, defectuosas } };
}

/** Cuántas unidades van en la solicitud. */
export function unidades(pedidos: Pedidos): number {
  return Object.values(pedidos).reduce((suma, p) => suma + p.cantidad, 0);
}

/** Las líneas como las espera `POST /api/devoluciones`: lo bueno y lo defectuoso van aparte. */
export function lineasDeSolicitud(pedidos: Pedidos) {
  return Object.entries(pedidos).flatMap(([detalle, pedido]) => {
    const detalle_id = Number(detalle);
    const buenas = pedido.cantidad - pedido.defectuosas;
    return [
      ...(buenas > 0 ? [{ detalle_id, cantidad: buenas, estado: 'BUENO' }] : []),
      ...(pedido.defectuosas > 0
        ? [{ detalle_id, cantidad: pedido.defectuosas, estado: 'DEFECTUOSO' }]
        : []),
    ];
  });
}

/**
 * Lo que vale esta solicitud, en centavos: lo pagado por cada unidad pedida. Es aproximado (lo
 * pagado por unidad llega redondeado): el monto exacto lo calcula la base al guardarla.
 */
export function montoAproximado(venta: VentaParaDevolver, pedidos: Pedidos): number {
  return venta.lineas.reduce(
    (suma, linea) =>
      suma + (pedidos[linea.detalle_id]?.cantidad ?? 0) * aCentavos(linea.monto_unitario),
    0,
  );
}

/**
 * El número de factura como lo espera la API. Vale lo que se lee del QR del ticket
 * (`LAM-00000012`) y lo que se escribe a mano: `lam-12`, `lam 12`, `lam12` y, cuando se sabe de
 * qué sucursal se habla, solo `12`. null si no parece un número de factura.
 */
export function numeroDeFactura(texto: string, codigoSucursal?: string | null): string | null {
  const limpio = texto.trim().toUpperCase();
  const completo = /^([A-Z]{2,5})[\s-]*(\d{1,8})$/.exec(limpio);
  if (completo) return `${completo[1]}-${completo[2].padStart(8, '0')}`;
  if (codigoSucursal && /^\d{1,8}$/.test(limpio)) {
    return `${codigoSucursal}-${limpio.padStart(8, '0')}`;
  }
  return null;
}

export interface DatosDeSolicitud {
  tipo: 'DEVOLUCION' | 'CAMBIO' | null;
  pedidos: Pedidos;
  motivo: string;
  nombre: string;
  telefono: string;
  /** Quien no está en un equipo y trabaja en varias sucursales dice en cuál está el cliente. */
  pideSucursal: boolean;
  sucursalId: number | null;
}

/** Qué falta para poder enviar la solicitud; null si está completa. La misma forma que pide la API. */
export function pendienteDeSolicitud(datos: DatosDeSolicitud): string | null {
  if (datos.tipo === null) return 'Elija si es una devolución o un cambio.';
  if (unidades(datos.pedidos) === 0) return 'Marque lo que devuelve el cliente.';
  if (datos.motivo.trim().length < 5) return 'Escriba el motivo (al menos 5 letras).';
  if (datos.nombre.trim().length < 3) return 'Escriba el nombre del cliente.';
  if (datos.telefono.trim().length < 7) {
    return 'Escriba el teléfono del cliente (al menos 7 números).';
  }
  if (datos.pideSucursal && datos.sucursalId === null) {
    return 'Elija la sucursal donde está el cliente.';
  }
  return null;
}
