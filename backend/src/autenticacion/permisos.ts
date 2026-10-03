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

/**
 * Comprueba el permiso de las rutas marcadas @RequierePermiso() con las funciones de la base
 * (fn_exigir_permiso / fn_tiene_permiso). El permiso se consulta en cada solicitud (no viaja en el
 * token): cambiar los permisos de un rol, cambiar de rol a un usuario o desactivarlo aplica de
 * inmediato. Sin el permiso → 403 PERMISO_DENEGADO.
 */
@Injectable()
export class GuardiaPermisos implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly bd: BaseDatosService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const permisos = this.reflector.getAllAndOverride<string[] | undefined>(PERMISOS_REQUERIDOS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!permisos?.length) return true;

    const usuario = contexto.switchToHttp().getRequest<Request>().usuario;
    if (!usuario) {
      throw new Error('@RequierePermiso() en una ruta sin sesión (¿marcada @Publica()?)');
    }
    if (permisos.length === 1) {
      await sql`select fn_exigir_permiso(${usuario.id}, ${permisos[0]})`.execute(this.bd.db);
      return true;
    }
    // Varios permisos: basta con tener uno
    const { rows } = await sql<{ alguno: boolean }>`
      select exists (select 1 from unnest(${permisos}::text[]) as p(codigo)
                      where fn_tiene_permiso(${usuario.id}, p.codigo)) as alguno`.execute(
      this.bd.db,
    );
    if (!rows[0].alguno) {
      throw new HttpException(
        {
          codigo: 'PERMISO_DENEGADO',
          mensaje: `Permiso denegado: se requiere ${permisos.join(' o ')}`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
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
