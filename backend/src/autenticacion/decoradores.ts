import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UsuarioAutenticado } from './usuario-autenticado';

export const ES_PUBLICA = 'esmeralda:publica';
export const CON_PASSWORD_TEMPORAL = 'esmeralda:password-temporal';

/** La ruta no exige sesión (todas las demás sí). */
export const Publica = () => SetMetadata(ES_PUBLICA, true);

/** La ruta se permite aunque el usuario todavía deba cambiar su contraseña temporal. */
export const PermitidaConPasswordTemporal = () => SetMetadata(CON_PASSWORD_TEMPORAL, true);

/** El usuario que hace la solicitud (solo en rutas que exigen sesión). */
export const UsuarioActual = createParamDecorator(
  (_dato: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
    const usuario = contexto.switchToHttp().getRequest<Request>().usuario;
    if (!usuario) throw new Error('@UsuarioActual() en una ruta sin sesión (¿marcada @Publica()?)');
    return usuario;
  },
);
