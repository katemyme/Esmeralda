import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';

/** Una ubicación (sucursal de venta o la bodega) con sus cajas. */
export interface SucursalConCajas {
  id: number;
  codigo: string;
  nombre: string;
  /** SUCURSAL (vende y tiene cajas) o BODEGA. */
  tipo: string;
  activa: boolean;
  cajas: { id: number; nombre: string; activa: boolean }[];
}

@Injectable()
export class SucursalesService {
  constructor(private readonly bd: BaseDatosService) {}

  /** Las ubicaciones en las que el usuario puede operar (el admin: todas), con sus cajas. */
  async listar(usuarioId: number): Promise<SucursalConCajas[]> {
    const { db } = this.bd;
    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo', 'nombre', 'tipo', 'activa'])
      .where(sql<boolean>`fn_puede_operar_sucursal(${usuarioId}, id)`)
      .orderBy('id')
      .execute();
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
