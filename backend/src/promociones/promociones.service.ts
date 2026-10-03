import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosPromocion } from './esquemas';

/** Una promoción en la pantalla del admin. */
export interface PromocionAdmin {
  id: number;
  nombre: string;
  descripcion: string | null;
  /** PORCENTAJE (valor = %) o MONTO (valor = córdobas). */
  tipo: string;
  valor: string;
  compra_minima: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  activa: boolean;
  /** VIGENTE (la ofrece el POS), PROGRAMADA, VENCIDA o INACTIVA, según la fecha de hoy en Managua. */
  estado: string;
  /** Ventas completadas que la usaron. */
  ventas: number;
  created_at: Date;
  updated_at: Date;
}

/** Una promoción que el POS puede aplicar hoy. */
export interface PromocionDisponible {
  id: number;
  nombre: string;
  tipo: string;
  valor: string;
  compra_minima: string;
  /** false si el subtotal no llega a la compra mínima (sin subtotal, siempre true). */
  aplica: boolean;
  /** Cuánto rebajaría (null si no se indicó el subtotal). */
  descuento: string | null;
}

/**
 * Promociones: la única forma de cobrar menos. Reglas en la base: fn_guardar_promocion,
 * fn_set_promocion_activa y fn_promociones_disponibles.
 */
@Injectable()
export class PromocionesService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<PromocionAdmin[]> {
    return this.consulta().orderBy('nombre').$castTo<PromocionAdmin>().execute();
  }

  /** Las activas y vigentes hoy, para el botón "Promoción" del POS. */
  async disponibles(subtotal: string | undefined): Promise<PromocionDisponible[]> {
    const { rows } = await sql<PromocionDisponible>`
      select promocion_id as id, nombre, tipo, valor, compra_minima, aplica, descuento
        from fn_promociones_disponibles(${subtotal ?? null}::numeric)`.execute(this.bd.db);
    return rows;
  }

  /** Crea la promoción (id null) o la edita. */
  async guardar(
    adminId: number,
    id: number | null,
    datos: DatosPromocion,
  ): Promise<PromocionAdmin> {
    const guardada = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_guardar_promocion(${adminId}, ${id}::integer, ${datos.nombre}, ${datos.tipo},
               ${datos.valor}::numeric, ${datos.compra_minima}::numeric, ${datos.vigente_desde}::date,
               ${datos.vigente_hasta}::date, ${datos.descripcion}) as id`.execute(trx);
      return rows[0].id;
    });
    return this.buscar(guardada);
  }

  async cambiarActiva(adminId: number, id: number, activa: boolean): Promise<PromocionAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_promocion_activa(${adminId}, ${id}, ${activa})`.execute(trx),
    );
    return this.buscar(id);
  }

  private async buscar(id: number): Promise<PromocionAdmin> {
    const promocion = await this.consulta()
      .where('id', '=', id)
      .$castTo<PromocionAdmin>()
      .executeTakeFirst();
    if (!promocion) throw new NoEncontrado(`La promoción ${id} no existe`);
    return promocion;
  }

  private consulta() {
    return this.bd.db
      .selectFrom('v_promociones_admin')
      .select([
        'id',
        'nombre',
        'descripcion',
        'tipo',
        'valor',
        'compra_minima',
        'vigente_desde',
        'vigente_hasta',
        'activa',
        'estado',
        'ventas',
        'created_at',
        'updated_at',
      ]);
  }
}
