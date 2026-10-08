// Fechas siempre en la hora de Managua, esté donde esté el equipo; montos con dos decimales.

const ZONA = 'America/Managua';

const fechaHora = new Intl.DateTimeFormat('es-NI', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const soloHora = new Intl.DateTimeFormat('es-NI', {
  timeZone: ZONA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const numero = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `08/10/2026, 03:42 p. m.` */
export function formatoFechaHora(iso: string): string {
  return fechaHora.format(new Date(iso));
}

/** `03:42 p. m.` */
export function formatoHora(iso: string): string {
  return soloHora.format(new Date(iso));
}

/** Un monto de la API ("1250.5") como `C$ 1,250.50` o `US$ 20.00`. */
export function formatoMonto(monto: string | number, moneda: 'NIO' | 'USD' = 'NIO'): string {
  return `${moneda === 'USD' ? 'US$' : 'C$'} ${numero.format(Number(monto))}`;
}

/** Solo el primer nombre: lo que cabe en un botón de la pantalla de PIN o en la barra. */
export function primerNombre(nombreCompleto: string): string {
  return nombreCompleto.trim().split(/\s+/)[0] ?? nombreCompleto;
}
