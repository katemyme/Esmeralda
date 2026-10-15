import type { DevolucionDetalle } from '../api/tipos';

// La ejecución de una devolución en caja, sin React. Qué se puede devolver, cuánto vale y cómo se
// reparte entre efectivo y transferencia lo dice la API; aquí solo se arma lo que se envía y se
// compara lo devuelto con lo que se lleva el cliente en un cambio (en centavos, para mostrarlo).

export type Estado = 'BUENO' | 'DEFECTUOSO';
type Linea = DevolucionDetalle['lineas'][number];

/** De entrada, cada línea se recibe en el estado en que se pidió. */
export function estadosIniciales(lineas: Linea[]): Record<number, Estado> {
  return Object.fromEntries(
    lineas.map((l) => [l.id, l.estado_producto === 'DEFECTUOSO' ? 'DEFECTUOSO' : 'BUENO']),
  );
}

/** Lo que se envía al ejecutar: solo las líneas que llegan en otro estado que el que se pidió. */
export function estadosCambiados(
  lineas: Linea[],
  elegidos: Record<number, Estado>,
): { id: number; estado: Estado }[] {
  return lineas
    .filter((l) => elegidos[l.id] !== undefined && elegidos[l.id] !== l.estado_producto)
    .map((l) => ({ id: l.id, estado: elegidos[l.id] }));
}

export interface CuentaDelCambio {
  /** Lo devuelto que se aplica a lo nuevo. */
  aplicado: number;
  /** Lo nuevo cuesta más: la diferencia que se cobra. */
  porCobrar: number;
  /** Lo nuevo cuesta menos: lo que se le entrega al cliente (como se pagó la factura). */
  sobrante: number;
}

/** En un cambio, lo devuelto paga primero lo nuevo: lo que falta se cobra y lo que sobra se entrega. */
export function cuentaDelCambio(devuelto: number, nuevo: number): CuentaDelCambio {
  return {
    aplicado: Math.min(devuelto, nuevo),
    porCobrar: Math.max(nuevo - devuelto, 0),
    sobrante: Math.max(devuelto - nuevo, 0),
  };
}
