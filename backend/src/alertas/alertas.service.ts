import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { FiltroAlertas } from './esquemas';

/** Una alerta para el administrador (margen bajo, diferencias de caja o de envío, sesión reutilizada...). */
export interface AlertaAdmin {
  id: number;
  tipo: string;
  titulo: string;
  /** Datos propios de cada tipo de alerta (ids, montos...). */
  detalle: unknown;
  sucursal: { id: number; codigo: string; nombre: string } | null;
  creada_at: Date;
  atendida_at: Date | null;
  atendida_por: { id: number; nombre_completo: string } | null;
}

interface FilaAlerta {
  id: number;
  tipo: string;
  titulo: string;
  detalle: unknown;
  creada_at: Date;
  atendida_at: Date | null;
  sucursal_id: number | null;
  sucursal_codigo: string | null;
  sucursal_nombre: string | null;
  atendida_por_id: number | null;
  atendida_por_nombre: string | null;
}

function aAlerta(fila: FilaAlerta): AlertaAdmin {
  return {
    id: fila.id,
    tipo: fila.tipo,
    titulo: fila.titulo,
    detalle: fila.detalle,
    sucursal:
      fila.sucursal_id !== null && fila.sucursal_codigo !== null && fila.sucursal_nombre !== null
        ? { id: fila.sucursal_id, codigo: fila.sucursal_codigo, nombre: fila.sucursal_nombre }
        : null,
    creada_at: fila.creada_at,
    atendida_at: fila.atendida_at,
    atendida_por:
      fila.atendida_por_id !== null && fila.atendida_por_nombre !== null
        ? { id: fila.atendida_por_id, nombre_completo: fila.atendida_por_nombre }
        : null,
  };
}

/** Alertas del panel. Las crea la base al aplicar las reglas; aquí se consultan y se atienden. */
@Injectable()
export class AlertasService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Alertas de la más reciente a la más antigua, y cuántas siguen pendientes en total. */
  async listar(
    filtro: FiltroAlertas,
  ): Promise<{ alertas: AlertaAdmin[]; total_pendientes: number }> {
    let consulta = this.consulta().orderBy('a.id', 'desc').limit(filtro.limite);
    if (filtro.estado === 'pendientes') consulta = consulta.where('a.atendida_at', 'is', null);
    if (filtro.estado === 'atendidas') consulta = consulta.where('a.atendida_at', 'is not', null);
    if (filtro.tipo) consulta = consulta.where('a.tipo', '=', filtro.tipo);
    if (filtro.sucursal_id) consulta = consulta.where('a.sucursal_id', '=', filtro.sucursal_id);
    if (filtro.antes_de) consulta = consulta.where('a.id', '<', filtro.antes_de);

    const [filas, pendientes] = await Promise.all([
      consulta.execute(),
      this.bd.db
        .selectFrom('alerta')
        .select((eb) => eb.fn.countAll<number>().as('total'))
        .where('atendida_at', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);
    return { alertas: filas.map(aAlerta), total_pendientes: pendientes.total };
  }

  /** Marca la alerta como atendida (si ya lo estaba, queda como estaba) y la devuelve. */
  async atender(adminId: number, id: number): Promise<AlertaAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_atender_alerta(${adminId}, ${id})`.execute(trx),
    );
    const fila = await this.consulta().where('a.id', '=', id).executeTakeFirst();
    if (!fila) throw new NoEncontrado(`La alerta ${id} no existe`);
    return aAlerta(fila);
  }

  private consulta() {
    return this.bd.db
      .selectFrom('alerta as a')
      .leftJoin('sucursal as s', 's.id', 'a.sucursal_id')
      .leftJoin('usuario as u', 'u.id', 'a.atendida_por')
      .select([
        'a.id',
        'a.tipo',
        'a.titulo',
        'a.detalle',
        'a.creada_at',
        'a.atendida_at',
        's.id as sucursal_id',
        's.codigo as sucursal_codigo',
        's.nombre as sucursal_nombre',
        'u.id as atendida_por_id',
        'u.nombre_completo as atendida_por_nombre',
      ]);
  }
}
