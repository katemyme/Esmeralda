import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosCategoria } from './esquemas';

export interface CategoriaCatalogo {
  id: number;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  /** Lo vendido de esta categoría se puede devolver o cambiar (lo decide el administrador). */
  admite_devolucion: boolean;
  /** Cuántos productos tiene (activos o no). */
  productos: number;
}

/**
 * Categorías del catálogo. Las reglas las aplican fn_guardar_categoria, fn_set_categoria_activa y
 * fn_set_categoria_devolucion (la casilla "admite devolución": una categoría nueva nace sin ella).
 */
@Injectable()
export class CategoriasService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<CategoriaCatalogo[]> {
    return this.consultar();
  }

  /** Crea la categoría (id null) o la edita. */
  async guardar(
    adminId: number,
    id: number | null,
    datos: DatosCategoria,
  ): Promise<CategoriaCatalogo> {
    const guardada = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_guardar_categoria(${adminId}, ${id}::integer, ${datos.nombre}, ${datos.descripcion}) as id`.execute(
        trx,
      );
      return rows[0].id;
    });
    return this.buscar(guardada);
  }

  async cambiarActiva(adminId: number, id: number, activa: boolean): Promise<CategoriaCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_categoria_activa(${adminId}, ${id}, ${activa})`.execute(trx),
    );
    return this.buscar(id);
  }

  /** La casilla es de quien aprueba las devoluciones (DEVOLUCIONES_APROBAR), no de quien edita el catálogo. */
  async cambiarAdmiteDevolucion(
    adminId: number,
    id: number,
    admite: boolean,
  ): Promise<CategoriaCatalogo> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_categoria_devolucion(${adminId}, ${id}, ${admite})`.execute(trx),
    );
    return this.buscar(id);
  }

  private async buscar(id: number): Promise<CategoriaCatalogo> {
    const [categoria] = await this.consultar(id);
    if (!categoria) throw new NoEncontrado(`La categoría ${id} no existe`);
    return categoria;
  }

  private async consultar(id?: number): Promise<CategoriaCatalogo[]> {
    let consulta = this.bd.db
      .selectFrom('categoria as c')
      .select((eb) => [
        'c.id',
        'c.nombre',
        'c.descripcion',
        'c.activa',
        'c.admite_devolucion',
        eb
          .selectFrom('producto as p')
          .select(eb.fn.countAll<number>().as('total'))
          .whereRef('p.categoria_id', '=', 'c.id')
          .as('productos'),
      ])
      .orderBy('c.nombre');
    if (id !== undefined) consulta = consulta.where('c.id', '=', id);
    const filas = await consulta.execute();
    return filas.map((fila) => ({ ...fila, productos: fila.productos ?? 0 }));
  }
}
