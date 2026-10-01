import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { CON_PASSWORD_TEMPORAL, ES_PUBLICA } from './decoradores';
import {
  usuarioDesdeToken,
  type ContenidoToken,
  type UsuarioAutenticado,
} from './usuario-autenticado';

function noAutenticado(codigo: string, mensaje: string): HttpException {
  return new HttpException({ codigo, mensaje }, HttpStatus.UNAUTHORIZED);
}

/**
 * Guardia global: toda ruta exige un token de acceso válido (`Authorization: Bearer ...`), salvo
 * las marcadas @Publica(). Quien todavía tiene la contraseña temporal solo puede usar las rutas
 * marcadas @PermitidaConPasswordTemporal() (cambiarla, ver sus datos, cerrar sesión).
 */
@Injectable()
export class GuardiaAutenticacion implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(contexto: ExecutionContext): boolean {
    const objetivos = [contexto.getHandler(), contexto.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ES_PUBLICA, objetivos)) return true;

    const solicitud = contexto.switchToHttp().getRequest<Request>();
    const usuario = this.leerToken(solicitud.headers.authorization);
    if (
      usuario.debeCambiarPassword &&
      !this.reflector.getAllAndOverride<boolean>(CON_PASSWORD_TEMPORAL, objetivos)
    ) {
      throw new HttpException(
        {
          codigo: 'DEBE_CAMBIAR_PASSWORD',
          mensaje: 'Debe cambiar su contraseña temporal antes de continuar',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    solicitud.usuario = usuario;
    return true;
  }

  private leerToken(cabecera: string | undefined): UsuarioAutenticado {
    const [tipo, token] = cabecera?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token) {
      throw noAutenticado('NO_AUTENTICADO', 'Inicie sesión para continuar');
    }
    try {
      return usuarioDesdeToken(this.jwt.verify<ContenidoToken>(token));
    } catch (error) {
      if ((error as { name?: string }).name === 'TokenExpiredError') {
        throw noAutenticado('TOKEN_VENCIDO', 'Su acceso venció: renueve la sesión');
      }
      throw noAutenticado('NO_AUTENTICADO', 'El token de acceso no es válido');
    }
  }
}
