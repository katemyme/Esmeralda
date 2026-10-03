import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde, veCostos } from '../comun/consultas';
import { NoEncontrado } from '../comun/no-encontrado';
import type { DatosReportarMerma, DatosResolverMerma, FiltroMermas } from './esquemas';

interface UsuarioReferido {
  id: number;
  nombre_completo: string;
}

/** Una pieza dañada o perdida: la reporta la sucursal y el admin la aprueba (descuenta) o la rechaza. */
export interface Merma {
  id: number;
  sucursal: { id: number; codigo: string; nombre: string };
  variante: { id: number; sku: string; nombre: string };
  cantidad: number;
  /** Lo que cuesta lo perdido; null para quien no tiene el permiso REPORTES_COSTOS. */
  valor_costo: string | null;
  motivo: string;
  foto_url: string | null;
  /** PENDIENTE, APROBADA o RECHAZADA. */
  estado: string;
  reportada_por: UsuarioReferido;
  reportada_at: Date;
  resuelta_por: UsuarioReferido | null;
  resuelta_at: Date | null;
  comentario: string | null;
}

interface FilaMerma {
  id: number;
  sucursal_id: number;
  sucursal_codigo: string;
  sucursal_nombre: string;
  variante_id: number;
  sku: string;
  variante_nombre: string;
  cantidad: number;
  valor_costo: string | null;
  motivo: string;
  foto_url: string | null;
  estado: string;
  reportada_por_id: number;
  reportada_por: string;
  reportada_at: Date;
  resuelta_por_id: number | null;
  resuelta_por: string | null;
  resuelta_at: Date | null;
  comentario: string | null;
}

function aMerma(f: FilaMerma): Merma {
  return {
    id: f.id,
    sucursal: { id: f.sucursal_id, codigo: f.sucursal_codigo, nombre: f.sucursal_nombre },
    variante: { id: f.variante_id, sku: f.sku, nombre: f.variante_nombre },
    cantidad: f.cantidad,
    valor_costo: f.valor_costo,
    motivo: f.motivo,
    foto_url: f.foto_url,
    estado: f.estado,
    reportada_por: { id: f.reportada_por_id, nombre_completo: f.reportada_por },
    reportada_at: f.reportada_at,
    resuelta_por:
      f.resuelta_por_id !== null && f.resuelta_por !== null
        ? { id: f.resuelta_por_id, nombre_completo: f.resuelta_por }
        : null,
    resuelta_at: f.resuelta_at,
    comentario: f.comentario,
  };
}

/**
 * Mermas. Las reglas (debe haber esa cantidad en la ubicación, alerta al admin, descuento al
 * aprobar) las aplica la base: fn_reportar_merma y fn_resolver_merma. Cada quien ve las de sus
 * sucursales.
 */
@Injectable()
export class MermasService {
  constructor(private readonly bd: BaseDatosService) {}

  async listar(usuarioId: number, filtro: FiltroMermas): Promise<Merma[]> {
    const filas = await this.consultar(
      usuarioId,
      [
        filtro.estado && sql`m.estado = ${filtro.estado}`,
        filtro.sucursal_id && sql`m.sucursal_id = ${filtro.sucursal_id}`,
        filtro.antes_de && sql`m.id < ${filtro.antes_de}`,
      ],
      filtro.limite,
    );
    return filas.map(aMerma);
  }

  async reportar(usuarioId: number, datos: DatosReportarMerma): Promise<Merma> {
    const id = await this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ id: number }>`
        select fn_reportar_merma(${usuarioId}, ${datos.sucursal_id}, ${datos.variante_id},
               ${datos.cantidad}, ${datos.motivo}, ${datos.foto_url}) as id`.execute(trx);
      return rows[0].id;
    });
    return this.buscar(usuarioId, id);
  }

  /** Aprobar descuenta la pieza del inventario; rechazar la deja como estaba. */
  async resolver(usuarioId: number, id: number, datos: DatosResolverMerma): Promise<Merma> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_resolver_merma(${usuarioId}, ${id}, ${datos.aprobar}, ${datos.comentario})`.execute(
        trx,
      ),
    );
    return this.buscar(usuarioId, id);
  }

  private async buscar(usuarioId: number, id: number): Promise<Merma> {
    const [fila] = await this.consultar(usuarioId, [sql`m.id = ${id}`], 1);
    if (!fila) throw new NoEncontrado(`La merma ${id} no existe`);
    return aMerma(fila);
  }

  private async consultar(
    usuarioId: number,
    condiciones: Parameters<typeof donde>,
    limite: number,
  ): Promise<FilaMerma[]> {
    const { rows } = await sql<FilaMerma>`
      select m.id, s.id as sucursal_id, s.codigo as sucursal_codigo, s.nombre as sucursal_nombre,
             va.id as variante_id, va.sku, pr.nombre || ' — ' || va.nombre as variante_nombre,
             m.cantidad,
             case when ${veCostos(usuarioId)} then round(m.cantidad * va.costo, 2) end as valor_costo,
             m.motivo, m.foto_url, m.estado,
             ur.id as reportada_por_id, ur.nombre_completo as reportada_por, m.reportada_at,
             ua.id as resuelta_por_id, ua.nombre_completo as resuelta_por, m.resuelta_at, m.comentario
        from merma m
        join sucursal s on s.id = m.sucursal_id
        join variante va on va.id = m.variante_id
        join producto pr on pr.id = va.producto_id
        join usuario ur on ur.id = m.reportada_por
        left join usuario ua on ua.id = m.resuelta_por
        ${donde(sql`fn_puede_operar_sucursal(${usuarioId}, m.sucursal_id)`, ...condiciones)}
       order by m.id desc
       limit ${limite}`.execute(this.bd.db);
    return rows;
  }
}
