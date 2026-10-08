import {
  applyDecorators,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';

const PERMISOS_REQUERIDOS = 'esmeralda:permisos';
const SOLO_EN_EQUIPO = 'esmeralda:solo-en-equipo';

/** Lo que se le dice a quien intenta desde su celular algo que es de la tablet de la sucursal. */
export const MENSAJE_EQUIPO_REQUERIDO =
  'Esto solo se puede hacer desde un equipo registrado de la sucursal (la tablet o la caja)';

export function errorEquipoRequerido(): HttpException {
  return new HttpException(
    { codigo: 'EQUIPO_REQUERIDO', mensaje: MENSAJE_EQUIPO_REQUERIDO },
    HttpStatus.FORBIDDEN,
  );
}

/**
 * Comprueba el permiso de las rutas marcadas @RequierePermiso() con la base (fn_permiso_en_sesion).
 * El permiso se consulta en cada solicitud (no viaja en el token): cambiar los permisos de un rol,
 * cambiar de rol a un usuario o desactivarlo aplica de inmediato. Sin el permiso → 403
 * PERMISO_DENEGADO.
 *
 * El permiso depende también de dónde se abrió la sesión: desde un celular (sin equipo registrado)
 * quien no es administrador solo usa los permisos marcados `sin_equipo`; con los demás, y en las
 * rutas @SoloEnEquipo(), responde 403 EQUIPO_REQUERIDO.
 */
@Injectable()
export class GuardiaPermisos implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly bd: BaseDatosService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const destinos = [contexto.getHandler(), contexto.getClass()];
    const permisos =
      this.reflector.getAllAndOverride<string[] | undefined>(PERMISOS_REQUERIDOS, destinos) ?? [];
    const soloEnEquipo =
      this.reflector.getAllAndOverride<boolean | undefined>(SOLO_EN_EQUIPO, destinos) === true;
    if (!permisos.length && !soloEnEquipo) return true;

    const solicitud = contexto.switchToHttp().getRequest<Request>();
    // Con @RequierePermiso() y @SoloEnEquipo() juntos el guardia está dos veces: basta una
    if (solicitud.permisosRevisados) return true;
    solicitud.permisosRevisados = true;
    const { usuario } = solicitud;
    if (!usuario) {
      throw new Error('@RequierePermiso() en una ruta sin sesión (¿marcada @Publica()?)');
    }
    const equipo = usuario.equipo?.id ?? null;
    // Con varios permisos basta con que uno valga en esta sesión
    const { rows } = await sql<{
      estado: 'OK' | 'SIN_EQUIPO' | 'SIN_PERMISO' | null;
      en_equipo: boolean;
    }>`
      select (select e.estado
                from unnest(${permisos}::text[]) as p(codigo)
               cross join lateral (select fn_permiso_en_sesion(${usuario.id}, p.codigo,
                                                                ${equipo}::uuid) as estado) e
               order by array_position(array['OK', 'SIN_EQUIPO', 'SIN_PERMISO'], e.estado)
               limit 1) as estado,
             fn_equipo_autorizado(${usuario.id}, ${equipo}::uuid) as en_equipo`.execute(this.bd.db);
    const { estado, en_equipo } = rows[0]; // estado es null si la ruta no pide ningún permiso

    if (estado === 'SIN_PERMISO') {
      throw new HttpException(
        {
          codigo: 'PERMISO_DENEGADO',
          mensaje: `Permiso denegado: se requiere ${permisos.join(' o ')}`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    if (estado === 'SIN_EQUIPO' || (soloEnEquipo && !en_equipo)) throw errorEquipoRequerido();
    return true;
  }
}

/**
 * La ruta exige un permiso (p. ej. 'USUARIOS_VER'); con varios, basta con tener uno de ellos. Se
 * comprueba antes de validar los datos enviados; en las escrituras, la función fn_* lo vuelve a
 * validar dentro de su transacción.
 */
export const RequierePermiso = (...codigos: string[]) =>
  applyDecorators(SetMetadata(PERMISOS_REQUERIDOS, codigos), UseGuards(GuardiaPermisos));

/**
 * La ruta es solo de un equipo registrado de la sucursal (o del administrador), aunque su permiso
 * valga desde el celular o no pida ninguno: el turno de la caja, imprimir en papel, ejecutar una
 * devolución, cerrar el equipo.
 */
export const SoloEnEquipo = () =>
  applyDecorators(SetMetadata(SOLO_EN_EQUIPO, true), UseGuards(GuardiaPermisos));
