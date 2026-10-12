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

const soloFecha = new Intl.DateTimeFormat('es-NI', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const diaIso = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const diaDeSemana = new Intl.DateTimeFormat('es-NI', { timeZone: 'UTC', weekday: 'long' });

/** `08/10/2026`: el día (de Managua) de un instante. */
export function formatoFecha(iso: string): string {
  return soloFecha.format(new Date(iso));
}

/** Un día que la API entrega como `2026-10-15` → `15/10/2026`. */
export function formatoDia(dia: string): string {
  const [anio, mes, numeroDeDia] = dia.split('-');
  return `${numeroDeDia}/${mes}/${anio}`;
}

/** El día de hoy en Managua, como lo esperan los filtros de la API: `2026-10-12`. */
export function hoyEnManagua(ahora: Date = new Date()): string {
  return diaIso.format(ahora);
}

/** `2026-10-12` más (o menos) tantos días. */
export function sumarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Cómo se le dice a un día en una lista: `Hoy`, `Ayer` o `sábado 10/10/2026`. */
export function nombreDeDia(dia: string, hoy: string): string {
  if (dia === hoy) return 'Hoy';
  if (dia === sumarDias(hoy, -1)) return 'Ayer';
  return `${diaDeSemana.format(new Date(`${dia}T00:00:00Z`))} ${formatoDia(dia)}`;
}

/** Un monto de la API ("1250.5") como `C$ 1,250.50` o `US$ 20.00`. */
export function formatoMonto(monto: string | number, moneda: 'NIO' | 'USD' = 'NIO'): string {
  return `${moneda === 'USD' ? 'US$' : 'C$'} ${numero.format(Number(monto))}`;
}

/** Solo el primer nombre: lo que cabe en un botón de la pantalla de PIN o en la barra. */
export function primerNombre(nombreCompleto: string): string {
  return nombreCompleto.trim().split(/\s+/)[0] ?? nombreCompleto;
}
