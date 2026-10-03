import { sql, type RawBuilder } from 'kysely';

// Además de la condición, lo que deja `filtro.x && sql`...`` cuando el filtro no se pidió
type Condicion = RawBuilder<unknown> | undefined | null | false | 0 | '';

/**
 * `where a and b and c` con las condiciones que apliquen; las que llegan vacías (un filtro que no
 * se pidió) se omiten. Sin ninguna, no agrega nada.
 */
export function donde(...condiciones: Condicion[]): RawBuilder<unknown> {
  const activas = condiciones.filter((c): c is RawBuilder<unknown> => !!c);
  return activas.length > 0 ? sql`where ${sql.join(activas, sql` and `)}` : sql``;
}

/** Patrón para ILIKE "contiene": los comodines que escriba el usuario se buscan como texto. */
export function patronContiene(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, '\\$&')}%`;
}

/** ¿Puede el usuario ver costos? Como subconsulta: la base la evalúa una sola vez por consulta. */
export function veCostos(usuarioId: number): RawBuilder<boolean> {
  return sql<boolean>`(select fn_tiene_permiso(${usuarioId}, 'REPORTES_COSTOS'))`;
}

/** `{ id, nombre }` si hay id, o null (para columnas de un LEFT JOIN). */
export function referencia<T extends number | string>(
  id: T | null,
  nombre: string | null,
): { id: T; nombre: string } | null {
  return id !== null && nombre !== null ? { id, nombre } : null;
}
