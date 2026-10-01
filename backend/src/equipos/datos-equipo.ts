import type { Kysely } from 'kysely';
import type { DB } from '../base-datos/tipos-bd';

/** Un equipo registrado tal como lo ve el frontend. */
export interface DatosEquipo {
  id: string;
  nombre: string;
  tipo: string;
  caja_id: number | null;
  sucursal: { id: number; codigo: string; nombre: string };
}

export async function buscarEquipo(db: Kysely<DB>, id: string): Promise<DatosEquipo | null> {
  const fila = await db
    .selectFrom('dispositivo as d')
    .innerJoin('sucursal as s', 's.id', 'd.sucursal_id')
    .select([
      'd.id',
      'd.nombre',
      'd.tipo',
      'd.caja_id',
      's.id as sucursal_id',
      's.codigo as sucursal_codigo',
      's.nombre as sucursal_nombre',
    ])
    .where('d.id', '=', id)
    .executeTakeFirst();
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    tipo: fila.tipo,
    caja_id: fila.caja_id,
    sucursal: { id: fila.sucursal_id, codigo: fila.sucursal_codigo, nombre: fila.sucursal_nombre },
  };
}
