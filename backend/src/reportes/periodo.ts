// Rangos de fechas de los reportes. Los días son los de Managua (AAAA-MM-DD) y la semana va de
// lunes a domingo, como en el resto del sistema.

export type Periodo = 'dia' | 'semana' | 'mes';

export interface Rango {
  desde: string;
  hasta: string;
}

/** El día de hoy en Managua. */
export function hoyEnManagua(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(ahora);
}

function aFecha(dia: string): Date {
  return new Date(`${dia}T00:00:00Z`);
}

function aDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function sumarDias(dia: string, dias: number): string {
  const fecha = aFecha(dia);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return aDia(fecha);
}

/** Cuántos días abarca el rango, contando los dos extremos. */
export function diasDelRango({ desde, hasta }: Rango): number {
  return Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000) + 1;
}

/** El día, la semana (de lunes a domingo) o el mes que contiene esa fecha. */
export function rangoDelPeriodo(periodo: Periodo, fecha: string): Rango {
  if (periodo === 'dia') return { desde: fecha, hasta: fecha };
  const f = aFecha(fecha);
  if (periodo === 'semana') {
    const lunes = sumarDias(fecha, -((f.getUTCDay() + 6) % 7)); // getUTCDay(): domingo = 0
    return { desde: lunes, hasta: sumarDias(lunes, 6) };
  }
  return {
    desde: aDia(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1))),
    hasta: aDia(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0))),
  };
}

/**
 * El rango de un reporte: `desde` y `hasta` si vienen; si no, el `periodo` (por defecto el día)
 * que contiene `fecha` (por defecto hoy).
 */
export function resolverRango(
  filtro: { periodo?: Periodo; fecha?: string; desde?: string; hasta?: string },
  hoy: string = hoyEnManagua(),
): Rango {
  if (filtro.desde && filtro.hasta) return { desde: filtro.desde, hasta: filtro.hasta };
  return rangoDelPeriodo(filtro.periodo ?? 'dia', filtro.fecha ?? hoy);
}
