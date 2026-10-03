import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosGama } from './esquemas';

export interface GamaCatalogo {
  id: number;
  nombre: string;
  /** TABLA (precio fijo por perforación) o PIEZA (servicio + precio de la pieza). */
  modo_precio: string;
  orden: number;
  activa: boolean;
  /** Cuántas piezas (variantes) pertenecen a la gama. */
  piezas: number;
}

/** Gamas de pieza para los paquetes de perforación. Reglas: fn_guardar_gama y fn_set_gama_activa. */
@Injectable()
export class GamasService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<GamaCatalogo[]> {
    return this.consultar();
  }

  /** Crea la gama (id null) o la edita. */
  async guardar(adminId: number, id: number | null, datos: DatosGama): Promise<GamaCatalogo> {
    const guardada = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_guardar_gama(${adminId}, ${id}::integer, ${datos.nombre}, ${datos.modo_precio},
               ${datos.orden}::integer) as id`.execute(trx);
      return rows[0].id;
    });
    return this.buscar(guardada);
  }

  async cambiarActiva(adminId: number, id: number, activa: boolean): Promise<GamaCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_gama_activa(${adminId}, ${id}, ${activa})`.execute(trx),
    );
    return this.buscar(id);
  }

  private async buscar(id: number): Promise<GamaCatalogo> {
    const [gama] = await this.consultar(id);
    if (!gama) throw new NoEncontrado(`La gama ${id} no existe`);
    return gama;
  }

  private async consultar(id?: number): Promise<GamaCatalogo[]> {
    let consulta = this.bd.db
      .selectFrom('gama as g')
      .select((eb) => [
        'g.id',
        'g.nombre',
        'g.modo_precio',
        'g.orden',
        'g.activa',
        eb
          .selectFrom('variante as v')
          .select(eb.fn.countAll<number>().as('total'))
          .whereRef('v.gama_id', '=', 'g.id')
          .as('piezas'),
      ])
      .orderBy('g.orden')
      .orderBy('g.nombre');
    if (id !== undefined) consulta = consulta.where('g.id', '=', id);
    const filas = await consulta.execute();
    return filas.map((fila) => ({ ...fila, piezas: fila.piezas ?? 0 }));
  }
}
