import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosCaja, DatosSucursal } from './esquemas';

/** Una ubicación (sucursal de venta o la bodega) con sus cajas. */
export interface SucursalConCajas {
  id: number;
  codigo: string;
  nombre: string;
  /** SUCURSAL (vende y tiene cajas) o BODEGA. */
  tipo: string;
  direccion: string | null;
  telefono: string | null;
  activa: boolean;
  cajas: { id: number; nombre: string; activa: boolean }[];
}

/**
 * Ubicaciones y cajas. Las reglas (código que no cambia con ventas, no desactivar con existencias,
 * turno abierto o envíos en tránsito, la bodega no lleva cajas) las aplica la base:
 * fn_guardar_sucursal, fn_set_sucursal_activa, fn_crear_caja, fn_renombrar_caja y fn_set_caja_activa.
 */
@Injectable()
export class SucursalesService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Las ubicaciones en las que el usuario puede operar (el admin: todas), con sus cajas. */
  listar(usuarioId: number): Promise<SucursalConCajas[]> {
    return this.consultar({ usuarioId });
  }

  /** Crea la sucursal (id null) o la edita. */
  async guardar(
    adminId: number,
    id: number | null,
    datos: DatosSucursal,
  ): Promise<SucursalConCajas> {
    const guardada = await this.bd.transaccion(adminId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_guardar_sucursal(${adminId}, ${id}::integer, ${datos.codigo}, ${datos.nombre},
               ${datos.direccion}, ${datos.telefono}) as id`.execute(trx);
      return rows[0].id;
    });
    return this.buscar(guardada);
  }

  async cambiarActiva(adminId: number, id: number, activa: boolean): Promise<SucursalConCajas> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_sucursal_activa(${adminId}, ${id}, ${activa})`.execute(trx),
    );
    return this.buscar(id);
  }

  async crearCaja(
    adminId: number,
    sucursalId: number,
    datos: DatosCaja,
  ): Promise<SucursalConCajas> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_crear_caja(${adminId}, ${sucursalId}, ${datos.nombre})`.execute(trx),
    );
    return this.buscar(sucursalId);
  }

  async renombrarCaja(
    adminId: number,
    cajaId: number,
    datos: DatosCaja,
  ): Promise<SucursalConCajas> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_renombrar_caja(${adminId}, ${cajaId}, ${datos.nombre})`.execute(trx),
    );
    return this.sucursalDeCaja(cajaId);
  }

  async cambiarCajaActiva(
    adminId: number,
    cajaId: number,
    activa: boolean,
  ): Promise<SucursalConCajas> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_caja_activa(${adminId}, ${cajaId}, ${activa})`.execute(trx),
    );
    return this.sucursalDeCaja(cajaId);
  }

  private async buscar(id: number): Promise<SucursalConCajas> {
    const [sucursal] = await this.consultar({ id });
    if (!sucursal) throw new NoEncontrado(`La sucursal ${id} no existe`);
    return sucursal;
  }

  private async sucursalDeCaja(cajaId: number): Promise<SucursalConCajas> {
    const caja = await this.bd.db
      .selectFrom('caja')
      .select('sucursal_id')
      .where('id', '=', cajaId)
      .executeTakeFirst();
    if (!caja) throw new NoEncontrado(`La caja ${cajaId} no existe`);
    return this.buscar(caja.sucursal_id);
  }

  /** Por usuario (solo donde puede operar) o por id (para el panel, sin ese filtro). */
  private async consultar(filtro: {
    usuarioId?: number;
    id?: number;
  }): Promise<SucursalConCajas[]> {
    const { db } = this.bd;
    let consulta = db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre', 'tipo', 'direccion', 'telefono', 'activa'])
      .orderBy('id');
    if (filtro.usuarioId !== undefined) {
      consulta = consulta.where(sql<boolean>`fn_puede_operar_sucursal(${filtro.usuarioId}, id)`);
    }
    if (filtro.id !== undefined) consulta = consulta.where('id', '=', filtro.id);
    const sucursales = await consulta.execute();
    if (sucursales.length === 0) return [];

    const cajas = await db
      .selectFrom('caja')
      .select(['id', 'sucursal_id', 'nombre', 'activa'])
      .where(
        'sucursal_id',
        'in',
        sucursales.map((s) => s.id),
      )
      .orderBy('id')
      .execute();
    return sucursales.map((sucursal) => ({
      ...sucursal,
      cajas: cajas
        .filter((caja) => caja.sucursal_id === sucursal.id)
        .map(({ id, nombre, activa }) => ({ id, nombre, activa })),
    }));
  }
}
