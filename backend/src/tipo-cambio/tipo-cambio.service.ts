import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { donde } from '../comun/consultas';
import type { DatosTipoCambio, FiltroHistorialTipoCambio } from './esquemas';

/** El tipo de cambio vigente: el último registrado hasta hoy (día de Managua). */
export interface TipoCambio {
  /** Día en que se registró (AAAA-MM-DD). */
  fecha: string;
  /** Córdobas por dólar. */
  usd_a_nio: string;
  /** false: hoy no se ha registrado y sigue valiendo el de un día anterior. */
  es_de_hoy: boolean;
  registrado_por: Persona;
}

type Persona = { id: number; nombre_completo: string } | null;

/** Un valor que se registró: el primero del día o una corrección. */
export interface RegistroTipoCambio {
  usd_a_nio: string;
  registrado_por: Persona;
  registrado_at: Date;
}

/** El tipo de cambio de un día: el valor con que quedó y todo lo que se registró ese día. */
export interface TipoCambioDelDia extends RegistroTipoCambio {
  fecha: string;
  /** En orden; el último es el que quedó. Con más de uno, ese día hubo correcciones. */
  registros: RegistroTipoCambio[];
}

function persona(id: number | null, nombre: string | null): Persona {
  return id !== null && nombre !== null ? { id, nombre_completo: nombre } : null;
}

/**
 * Tipo de cambio del dólar. Lo registra quien tiene TIPO_CAMBIO_GESTIONAR con fn_set_tipo_cambio:
 * solo el de hoy, que se puede corregir durante el día (cada venta guarda el tipo de cambio con
 * que se cobró, así que el cambio vale para las ventas siguientes). La misma función controla los
 * errores de dedo: el primero debe estar entre 20 y 60, y los siguientes no pueden alejarse del
 * último más que el parámetro TIPO_CAMBIO_VARIACION_MAX sin una confirmación explícita.
 */
@Injectable()
export class TipoCambioService {
  constructor(private readonly bd: BaseDatosService) {}

  /** null si todavía no se ha registrado ninguno. */
  async vigente(): Promise<TipoCambio | null> {
    const { rows } = await sql<{
      fecha: string;
      usd_a_nio: string;
      es_de_hoy: boolean;
      usuario_id: number | null;
      usuario: string | null;
    }>`
      select tc.fecha, tc.usd_a_nio,
             tc.fecha = (now() at time zone 'America/Managua')::date as es_de_hoy,
             u.id as usuario_id, u.nombre_completo as usuario
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
      es_de_hoy: fila.es_de_hoy,
      registrado_por: persona(fila.usuario_id, fila.usuario),
    };
  }

  /**
   * Los tipos de cambio registrados, un día por fila, del más reciente al más antiguo. La tabla
   * guarda un valor por día (el último); lo que se registró antes de una corrección sale de la
   * bitácora, que anota cada cambio de la tabla con su hora.
   */
  async historial(filtro: FiltroHistorialTipoCambio): Promise<TipoCambioDelDia[]> {
    const { rows } = await sql<{
      fecha: string;
      usd_a_nio: string;
      usuario_id: number | null;
      usuario: string | null;
      created_at: Date;
      registros: {
        usd_a_nio: string;
        usuario_id: number | null;
        usuario: string | null;
        registrado_at: string;
      }[];
    }>`
      select tc.fecha, tc.usd_a_nio, u.id as usuario_id, u.nombre_completo as usuario,
             tc.created_at, coalesce(b.registros, '[]'::json) as registros
        from tipo_cambio tc
        left join usuario u on u.id = tc.usuario_id
        left join lateral (
             select json_agg(json_build_object(
                      'usd_a_nio', (a.despues->>'usd_a_nio')::numeric(10,4)::text,
                      'usuario_id', ua.id, 'usuario', ua.nombre_completo,
                      'registrado_at', a.fecha) order by a.id) as registros
               from auditoria a
               left join usuario ua on ua.id = (a.despues->>'usuario_id')::bigint
              where a.tabla = 'tipo_cambio' and a.accion in ('INSERT', 'UPDATE')
                and (a.despues->>'fecha')::date = tc.fecha) b on true
        ${donde(
          filtro.desde && sql`tc.fecha >= ${filtro.desde}::date`,
          filtro.hasta && sql`tc.fecha <= ${filtro.hasta}::date`,
        )}
       order by tc.fecha desc
       limit ${filtro.limite}`.execute(this.bd.db);
    return rows.map((fila) => {
      const registros = fila.registros.map((r) => ({
        usd_a_nio: r.usd_a_nio,
        registrado_por: persona(r.usuario_id, r.usuario),
        registrado_at: new Date(r.registrado_at),
      }));
      const vigente = {
        usd_a_nio: fila.usd_a_nio,
        registrado_por: persona(fila.usuario_id, fila.usuario),
        // la hora de la última corrección; sin bitácora de ese día, la del primer registro
        registrado_at: registros.at(-1)?.registrado_at ?? fila.created_at,
      };
      return {
        fecha: fila.fecha,
        ...vigente,
        registros: registros.length > 0 ? registros : [vigente],
      };
    });
  }

  /**
   * Si el valor se aleja demasiado del último registrado y no viene confirmado, la base lo rechaza
   * (409 CONFIRMACION_REQUERIDA): la pantalla pregunta y lo reenvía con `confirmar: true`.
   */
  async registrar(usuarioId: number, datos: DatosTipoCambio): Promise<TipoCambio | null> {
    await this.bd.transaccion(usuarioId, (trx) =>
      sql`select fn_set_tipo_cambio(${usuarioId}, ${datos.usd_a_nio}::numeric,
                 ${datos.confirmar})`.execute(trx),
    );
    return this.vigente();
  }
}
