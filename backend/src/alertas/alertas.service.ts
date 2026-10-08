import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { FiltroAlertas } from './esquemas';

/**
 * Una alerta para el administrador (margen bajo, diferencias de caja o de envío, sesión
 * reutilizada...) o un aviso para quienes trabajan en una sucursal.
 */
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

export interface ListaAlertas {
  alertas: AlertaAdmin[];
  total_pendientes: number;
}

/** Alertas. Las crea la base al aplicar las reglas; aquí se consultan y se atienden. */
@Injectable()
export class AlertasService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Alertas del panel, de la más reciente a la más antigua, y cuántas siguen pendientes en total. */
  listar(filtro: FiltroAlertas): Promise<ListaAlertas> {
    return this.lista(filtro, sql<boolean>`not a.para_sucursal`);
  }

  /**
   * Los avisos para quienes trabajan en la sucursal (la devolución aprobada que venció): cada quien
   * ve los de sus sucursales. No salen en el panel, que tiene su propia alerta.
   */
  listarDeSucursal(usuarioId: number, filtro: FiltroAlertas): Promise<ListaAlertas> {
    return this.lista(
      filtro,
      sql<boolean>`a.para_sucursal and fn_puede_operar_sucursal(${usuarioId}, a.sucursal_id)`,
    );
  }

  /**
   * Marca la alerta como atendida (si ya lo estaba, queda como estaba) y la devuelve. La base
   * decide si le toca: las del panel piden ALERTAS_VER; las de una sucursal, trabajar en ella.
   */
  async atender(usuarioId: number, id: number): Promise<AlertaAdmin> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_atender_alerta(${usuarioId}, ${id})`.execute(trx),
    );
    const fila = await this.consulta().where('a.id', '=', id).executeTakeFirst();
    if (!fila) throw new NoEncontrado(`La alerta ${id} no existe`);
    return aAlerta(fila);
  }

  private async lista(filtro: FiltroAlertas, alcance: RawBuilder<boolean>): Promise<ListaAlertas> {
    let consulta = this.consulta().where(alcance).orderBy('a.id', 'desc').limit(filtro.limite);
    if (filtro.estado === 'pendientes') consulta = consulta.where('a.atendida_at', 'is', null);
    if (filtro.estado === 'atendidas') consulta = consulta.where('a.atendida_at', 'is not', null);
    if (filtro.tipo) consulta = consulta.where('a.tipo', '=', filtro.tipo);
    if (filtro.sucursal_id) consulta = consulta.where('a.sucursal_id', '=', filtro.sucursal_id);
    if (filtro.antes_de) consulta = consulta.where('a.id', '<', filtro.antes_de);

    const [filas, pendientes] = await Promise.all([
      consulta.execute(),
      this.bd.db
        .selectFrom('alerta as a')
        .select((eb) => eb.fn.countAll<number>().as('total'))
        .where(alcance)
        .where('a.atendida_at', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);
    return { alertas: filas.map(aAlerta), total_pendientes: pendientes.total };
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
