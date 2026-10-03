import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosProveedor } from './esquemas';

export interface Proveedor {
  id: number;
  nombre: string;
  pais: string | null;
  moneda_habitual: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  /** Compras registradas a este proveedor (en cualquier estado). */
  compras: number;
}

/** Proveedores. Reglas en la base: fn_crear_proveedor, fn_actualizar_proveedor y fn_set_proveedor_activo. */
@Injectable()
export class ProveedoresService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<Proveedor[]> {
    return this.consultar();
  }

  async crear(adminId: number, datos: DatosProveedor): Promise<Proveedor> {
    const id = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_crear_proveedor(${adminId}, ${datos.nombre}, ${datos.pais}, ${datos.moneda_habitual},
               ${datos.contacto}, ${datos.telefono}, ${datos.email}) as id`.execute(trx);
      return rows[0].id;
    });
    return this.buscar(id);
  }

  async actualizar(adminId: number, id: number, datos: DatosProveedor): Promise<Proveedor> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_actualizar_proveedor(${adminId}, ${id}, ${datos.nombre}, ${datos.pais},
                 ${datos.moneda_habitual}, ${datos.contacto}, ${datos.telefono}, ${datos.email})`.execute(
        trx,
      ),
    );
    return this.buscar(id);
  }

  async cambiarActivo(adminId: number, id: number, activo: boolean): Promise<Proveedor> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_proveedor_activo(${adminId}, ${id}, ${activo})`.execute(trx),
    );
    return this.buscar(id);
  }

  private async buscar(id: number): Promise<Proveedor> {
    const [proveedor] = await this.consultar(id);
    if (!proveedor) throw new NoEncontrado(`El proveedor ${id} no existe`);
    return proveedor;
  }

  private async consultar(id?: number): Promise<Proveedor[]> {
    let consulta = this.bd.db
      .selectFrom('proveedor as p')
      .select((eb) => [
        'p.id',
        'p.nombre',
        'p.pais',
        'p.moneda_habitual',
        'p.contacto',
        'p.telefono',
        'p.email',
        'p.activo',
        eb
          .selectFrom('compra as c')
          .select(eb.fn.countAll<number>().as('total'))
          .whereRef('c.proveedor_id', '=', 'p.id')
          .as('compras'),
      ])
      .orderBy('p.nombre');
    if (id !== undefined) consulta = consulta.where('p.id', '=', id);
    const filas = await consulta.execute();
    return filas.map((fila) => ({ ...fila, compras: fila.compras ?? 0 }));
  }
}
