import { sql, type Kysely } from 'kysely';
import type { DB } from '../base-datos/tipos-bd';

/** Un equipo registrado tal como lo ve el frontend. */
export interface DatosEquipo {
  id: string;
  nombre: string;
  tipo: string;
  caja_id: number | null;
  sucursal: { id: number; codigo: string; nombre: string };
}

/** Un equipo en el panel de administración (nunca incluye su token). */
export interface EquipoAdmin extends DatosEquipo {
  activo: boolean;
  caja_nombre: string | null;
  registrado_por: { id: number; nombre_completo: string };
  created_at: Date;
  ultimo_uso: Date | null;
  /** Sesiones abiertas desde este equipo en este momento. */
  sesiones_activas: number;
}

/** Todos los equipos registrados (o solo el del id), activos e inactivos. */
export async function listarEquipos(db: Kysely<DB>, id?: string): Promise<EquipoAdmin[]> {
  let consulta = db
    .selectFrom('dispositivo as d')
    .innerJoin('sucursal as s', 's.id', 'd.sucursal_id')
    .innerJoin('usuario as u', 'u.id', 'd.registrado_por')
    .leftJoin('caja as c', 'c.id', 'd.caja_id')
    .select((eb) => [
      'd.id',
      'd.nombre',
      'd.tipo',
      'd.caja_id',
      'd.activo',
      'd.created_at',
      'd.ultimo_uso',
      'c.nombre as caja_nombre',
      's.id as sucursal_id',
      's.codigo as sucursal_codigo',
      's.nombre as sucursal_nombre',
      'u.id as registrado_por_id',
      'u.nombre_completo as registrado_por_nombre',
      eb
        .selectFrom('sesion as se')
        .select(eb.fn.countAll<number>().as('total'))
        .whereRef('se.dispositivo_id', '=', 'd.id')
        .where('se.revocada_at', 'is', null)
        .where('se.expira_at', '>', sql<Date>`now()`)
        .as('sesiones_activas'),
    ])
    .orderBy('s.id')
    .orderBy('d.nombre')
    .orderBy('d.created_at');
  if (id !== undefined) consulta = consulta.where('d.id', '=', id);

  const filas = await consulta.execute();
  return filas.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    tipo: fila.tipo,
    caja_id: fila.caja_id,
    caja_nombre: fila.caja_nombre,
    sucursal: { id: fila.sucursal_id, codigo: fila.sucursal_codigo, nombre: fila.sucursal_nombre },
    activo: fila.activo,
    registrado_por: { id: fila.registrado_por_id, nombre_completo: fila.registrado_por_nombre },
    created_at: fila.created_at,
    ultimo_uso: fila.ultimo_uso,
    sesiones_activas: fila.sesiones_activas ?? 0,
  }));
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
