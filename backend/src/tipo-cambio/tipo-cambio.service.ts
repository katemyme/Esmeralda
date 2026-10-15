import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde } from '../comun/consultas';
import { finDelDia, inicioDelDia } from '../comun/fechas';
import type { DatosTipoCambio, FiltroHistorialTipoCambio } from './esquemas';

/** El tipo de cambio vigente: el último que se fijó. Rige todos los días hasta que se cambie. */
export interface TipoCambio {
  /** Desde qué día rige (AAAA-MM-DD). */
  fecha: string;
  /** Córdobas por dólar. */
  usd_a_nio: string;
  /** null: es el valor de los datos iniciales, no lo puso nadie. */
  registrado_por: Persona;
}

type Persona = { id: number; nombre_completo: string } | null;

/** Un cambio del tipo de cambio: de cuánto a cuánto, quién y cuándo. */
export interface CambioTipoCambio {
  /** Córdobas por dólar desde este cambio. */
  usd_a_nio: string;
  /** El que regía antes; null en el primero (el valor inicial). */
  anterior: string | null;
  /** null: el valor de los datos iniciales, que no puso nadie. */
  registrado_por: Persona;
  registrado_at: Date;
}

function persona(id: number | null, nombre: string | null): Persona {
  return id !== null && nombre !== null ? { id, nombre_completo: nombre } : null;
}

/**
 * Tipo de cambio del dólar. No se registra cada día: hay uno vigente, que arranca en el de los datos
 * iniciales y se queda fijo hasta que alguien con TIPO_CAMBIO_GESTIONAR (solo el administrador) lo
 * cambia con fn_set_tipo_cambio. Cada venta guarda el tipo de cambio con que se cobró, así que el
 * cambio vale para las ventas siguientes. La misma función controla los errores de dedo: el nuevo
 * no puede alejarse del vigente más que el parámetro TIPO_CAMBIO_VARIACION_MAX sin una
 * confirmación explícita.
 */
@Injectable()
export class TipoCambioService {
  constructor(private readonly bd: BaseDatosService) {}

  /** null si no hay ninguno (los datos iniciales traen uno: no debería pasar). */
  async vigente(): Promise<TipoCambio | null> {
    const { rows } = await sql<{
      fecha: string;
      usd_a_nio: string;
      usuario_id: number | null;
      usuario: string | null;
    }>`
      select tc.fecha, tc.usd_a_nio, u.id as usuario_id, u.nombre_completo as usuario
        from tipo_cambio tc
        left join usuario u on u.id = tc.usuario_id
       where tc.fecha <= (now() at time zone 'America/Managua')::date
       order by tc.fecha desc
       limit 1`.execute(this.bd.db);
    const fila = rows[0];
    if (!fila) return null;
    return {
      fecha: fila.fecha,
      usd_a_nio: fila.usd_a_nio,
      registrado_por: persona(fila.usuario_id, fila.usuario),
    };
  }

  /**
   * Los cambios, del más reciente al más antiguo. La tabla guarda un valor por día (el último);
   * cada cambio, con su hora y quién lo hizo, sale de la bitácora. Lo que se volvió a poner con el
   * mismo valor que ya regía no es un cambio y no sale.
   */
  async historial(filtro: FiltroHistorialTipoCambio): Promise<CambioTipoCambio[]> {
    const { rows } = await sql<{
      usd_a_nio: string;
      anterior: string | null;
      usuario_id: number | null;
      usuario: string | null;
      registrado_at: Date;
    }>`
      with registros as (
        select a.id, (a.despues->>'usd_a_nio')::numeric(10,4) as usd_a_nio,
               (a.despues->>'usuario_id')::bigint as usuario_id, a.fecha as registrado_at
          from auditoria a
         where a.tabla = 'tipo_cambio' and a.accion in ('INSERT', 'UPDATE')
      ), cambios as (
        select r.*, lag(r.usd_a_nio) over (order by r.id) as anterior from registros r
      )
      select c.usd_a_nio::text as usd_a_nio, c.anterior::text as anterior,
             u.id as usuario_id, u.nombre_completo as usuario, c.registrado_at
        from cambios c
        left join usuario u on u.id = c.usuario_id
        ${donde(
          sql`c.usd_a_nio is distinct from c.anterior`,
          filtro.desde && sql`c.registrado_at >= ${inicioDelDia(filtro.desde)}`,
          filtro.hasta && sql`c.registrado_at < ${finDelDia(filtro.hasta)}`,
        )}
       order by c.id desc
       limit ${filtro.limite}`.execute(this.bd.db);
    return rows.map((fila) => ({
      usd_a_nio: fila.usd_a_nio,
      anterior: fila.anterior,
      registrado_por: persona(fila.usuario_id, fila.usuario),
      registrado_at: fila.registrado_at,
    }));
  }

  /**
   * Si el valor se aleja demasiado del vigente y no viene confirmado, la base lo rechaza (409
   * CONFIRMACION_REQUERIDA): la pantalla pregunta y lo reenvía con `confirmar: true`. El mismo
   * valor que ya rige no cambia nada.
   */
  async registrar(usuarioId: number, datos: DatosTipoCambio): Promise<TipoCambio | null> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_set_tipo_cambio(${usuarioId}, ${datos.usd_a_nio}::numeric,
                 ${datos.confirmar})`.execute(trx),
    );
    return this.vigente();
  }
}
