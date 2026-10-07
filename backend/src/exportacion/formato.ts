// Cómo se escriben fechas y montos en los archivos que se exportan (Excel, PDF) y en los tickets.
// Las horas son las de Managua.

const ZONA = 'America/Managua';

const PARTES_FECHA_HORA = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const MILES = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ENTERO = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function partes(instante: Date): Record<string, string> {
  return Object.fromEntries(
    PARTES_FECHA_HORA.formatToParts(instante).map((p) => [p.type, p.value]),
  );
}

/** "2026-10-07" → "07/10/2026". */
export function fechaCorta(dia: string): string {
  const [anio, mes, diaDelMes] = dia.split('-');
  return `${diaDelMes}/${mes}/${anio}`;
}

/** "2026-10-01" o "2026-10" → "10/2026". */
export function mesCorto(dia: string): string {
  const [anio, mes] = dia.split('-');
  return `${mes}/${anio}`;
}

/** Un instante → "07/10/2026 15:42" (hora de Managua). */
export function fechaHora(instante: Date): string {
  const p = partes(instante);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/**
 * El mismo instante como fecha "de pared" de Managua guardada en UTC: así la escribe Excel, que no
 * maneja zonas horarias.
 */
export function horaDeManaguaEnUtc(instante: Date): Date {
  const p = partes(instante);
  return new Date(
    Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)),
  );
}

/** "1250.5" → "1,250.50". */
export function monto(valor: string | number): string {
  return MILES.format(Number(valor));
}

export function entero(valor: string | number): string {
  return ENTERO.format(Number(valor));
}
