// Cuentas de dinero en la pantalla: siempre en centavos enteros, para no perder ninguno con los
// decimales del navegador. Las reglas (lo esperado, el vuelto, las diferencias) son de la base: aquí
// solo se suma lo que la persona misma escribe o cuenta.

/** `"1250.5"` → `125050`. */
export function aCentavos(monto: string | number): number {
  return Math.round(Number(monto) * 100);
}

/** `125050` → `"1250.50"`, como lo espera la API. */
export function deCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** ¿Es un monto que la API acepta? De 0 en adelante, con 2 decimales como máximo. */
export function esMonto(texto: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(texto.trim());
}

/** Lo contado en billetes y monedas: la suma de valor × cantidad, en centavos. */
export function totalContado(conteo: { valor: string; cantidad: number }[]): number {
  return conteo.reduce((suma, c) => suma + aCentavos(c.valor) * c.cantidad, 0);
}

/**
 * Dólares a córdobas con el tipo de cambio del día, todo en centavos y con el mismo redondeo que
 * la base (`round(monto * tipo_cambio, 2)`): con enteros, para que no baile ni un centavo.
 */
export function dolaresACordobas(centavosUsd: number, usdANio: string | number): number {
  const tasa = Math.round(Number(usdANio) * 10_000); // el tipo de cambio lleva 4 decimales
  return Math.floor((centavosUsd * tasa + 5_000) / 10_000);
}

/** Un identificador único (UUID v4). `crypto.randomUUID` no existe fuera de https o localhost. */
export function nuevoUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
