import { HttpException, HttpStatus } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import type { DB } from '../base-datos/tipos-bd';

/**
 * La caja y el turno de una solicitud no los manda la pantalla: salen del equipo registrado en el
 * que se inició la sesión (fn_caja_de_sesion / fn_turno_de_sesion). `cajaElegida` es solo para el
 * administrador, y solo cuando su equipo no tiene una caja propia. La base vuelve a leer el equipo
 * en cada solicitud: desactivarlo o quitarle la sucursal a alguien aplica de inmediato.
 */

/** El administrador fuera de un equipo registrado tiene que decir con qué caja trabaja. */
function exigirOrigen(usuario: UsuarioAutenticado, cajaElegida: number | undefined): void {
  if (usuario.equipo || cajaElegida !== undefined) return;
  throw new HttpException(
    {
      codigo: 'DATOS_INVALIDOS',
      mensaje: 'Indique la caja (caja_id): esta sesión no es de un equipo registrado',
    },
    HttpStatus.BAD_REQUEST,
  );
}

/** `fn_caja_de_sesion(...)` para usar dentro de otra consulta: la caja en la que se abre el turno. */
export function cajaParaAbrir(
  usuario: UsuarioAutenticado,
  cajaElegida: number | undefined,
): RawBuilder<number> {
  exigirOrigen(usuario, cajaElegida);
  return sql<number>`fn_caja_de_sesion(${usuario.id}, ${usuario.equipo?.id ?? null}::uuid,
                                       ${cajaElegida ?? null}::integer, true)`;
}

/** El turno abierto de la caja de la sesión, o null si esa caja está cerrada. */
export async function turnoDeSesion(
  bd: Kysely<DB>,
  usuario: UsuarioAutenticado,
  cajaElegida: number | undefined,
): Promise<number | null> {
  exigirOrigen(usuario, cajaElegida);
  const { rows } = await sql<{ turno: number | null }>`
    select fn_turno_de_sesion(${usuario.id}, ${usuario.equipo?.id ?? null}::uuid,
                              ${cajaElegida ?? null}::integer) as turno`.execute(bd);
  return rows[0].turno;
}

/** Lo mismo, para lo que solo se hace con la caja abierta: sin turno → 409 SIN_TURNO_ABIERTO. */
export async function exigirTurno(
  bd: Kysely<DB>,
  usuario: UsuarioAutenticado,
  cajaElegida: number | undefined,
): Promise<number> {
  const turno = await turnoDeSesion(bd, usuario, cajaElegida);
  if (turno === null) {
    throw new HttpException(
      { codigo: 'SIN_TURNO_ABIERTO', mensaje: 'La caja no tiene un turno abierto: ábrala primero' },
      HttpStatus.CONFLICT,
    );
  }
  return turno;
}
