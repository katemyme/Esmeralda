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
