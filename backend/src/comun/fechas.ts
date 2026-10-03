import { sql, type RawBuilder } from 'kysely';

// Los reportes y filtros por fecha usan el día de Managua, no el del servidor
const ZONA = sql.lit('America/Managua');

/** Instante en que empieza ese día (AAAA-MM-DD) en Managua: límite inclusivo de `desde`. */
export function inicioDelDia(fecha: string): RawBuilder<Date> {
  return sql<Date>`(${fecha}::date)::timestamp at time zone ${ZONA}`;
}

/** Instante en que empieza el día siguiente en Managua: límite exclusivo de `hasta`. */
export function finDelDia(fecha: string): RawBuilder<Date> {
  return sql<Date>`(${fecha}::date + 1)::timestamp at time zone ${ZONA}`;
}
