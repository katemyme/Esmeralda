import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { generarToken, sha256 } from '../autenticacion/seguridad';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';
import { buscarEquipo, listarEquipos, type DatosEquipo, type EquipoAdmin } from './datos-equipo';
import type { DatosRegistroEquipo } from './esquemas';

@Injectable()
export class EquiposService {
  constructor(private readonly bd: BaseDatosService) {}

  /**
   * Registra el equipo desde el que se hace la solicitud. Devuelve su token, que se entrega UNA
   * sola vez (en una cookie); la base guarda solo su SHA-256. El permiso SUCURSALES_GESTIONAR y la
   * coherencia caja/sucursal los valida fn_registrar_dispositivo.
   */
  async registrar(
    usuarioId: number,
    datos: DatosRegistroEquipo,
  ): Promise<{ token: string; equipo: DatosEquipo }> {
    const token = generarToken();
    const id = await this.bd.transaccion(usuarioId, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        select fn_registrar_dispositivo(${usuarioId}, ${datos.nombre}, ${datos.tipo},
               ${datos.sucursal_id}, ${sha256(token)}, ${datos.caja_id ?? null}::integer) as id`.execute(
        trx,
      );
      return rows[0].id;
    });
    const equipo = await buscarEquipo(this.bd.db, id);
    if (!equipo) throw new Error(`El equipo ${id} recién registrado no aparece`);
    return { token, equipo };
  }

  /** Todos los equipos registrados, para el panel de administración. */
  listar(): Promise<EquipoAdmin[]> {
    return listarEquipos(this.bd.db);
  }

  /**
   * Activa o desactiva un equipo (fn_set_dispositivo_activo). Desactivarlo cierra las sesiones
   * abiertas desde él y nadie puede volver a entrar desde ese equipo hasta reactivarlo.
   */
  async cambiarActivo(adminId: number, id: string, activo: boolean): Promise<EquipoAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_dispositivo_activo(${adminId}, ${id}::uuid, ${activo})`.execute(trx),
    );
    const [equipo] = await listarEquipos(this.bd.db, id);
    if (!equipo) throw new NoEncontrado(`El equipo ${id} no existe`);
    return equipo;
  }

  /** El equipo registrado al que pertenece un token (null si no existe o está desactivado). */
  async identificar(token: string | undefined): Promise<DatosEquipo | null> {
    if (!token) return null;
    const fila = await this.bd.transaccion(null, async (trx) => {
      const { rows } = await sql<{ dispositivo_id: string }>`
        select dispositivo_id from fn_dispositivo_por_token(${sha256(token)})`.execute(trx);
      return rows[0];
    });
    return fila ? buscarEquipo(this.bd.db, fila.dispositivo_id) : null;
  }
}
