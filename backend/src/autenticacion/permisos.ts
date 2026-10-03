import {
  applyDecorators,
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

const PERMISO_REQUERIDO = 'esmeralda:permiso';

/**
 * Comprueba el permiso de las rutas marcadas @RequierePermiso() con fn_exigir_permiso. El permiso
 * se consulta en la base en cada solicitud (no viaja en el token): cambiar los permisos de un rol,
 * cambiar de rol a un usuario o desactivarlo aplica de inmediato. Sin el permiso → 403 PERMISO_DENEGADO.
 */
@Injectable()
export class GuardiaPermisos implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly bd: BaseDatosService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const permiso = this.reflector.getAllAndOverride<string | undefined>(PERMISO_REQUERIDO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!permiso) return true;

    const usuario = contexto.switchToHttp().getRequest<Request>().usuario;
    if (!usuario) {
      throw new Error('@RequierePermiso() en una ruta sin sesión (¿marcada @Publica()?)');
    }
    await sql`select fn_exigir_permiso(${usuario.id}, ${permiso})`.execute(this.bd.db);
    return true;
  }
}

/**
 * La ruta exige un permiso (p. ej. 'USUARIOS_VER'). Se comprueba antes de validar los datos
 * enviados; en las escrituras, la función fn_* lo vuelve a validar dentro de su transacción.
 */
export const RequierePermiso = (codigo: string) =>
  applyDecorators(SetMetadata(PERMISO_REQUERIDO, codigo), UseGuards(GuardiaPermisos));
