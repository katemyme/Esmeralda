import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { CONFIGURACION, type Configuracion } from '../configuracion/configuracion';
import { PREFIJO_API } from '../configurar-app';

export const COOKIE_SESION = 'esmeralda_sesion';
export const COOKIE_EQUIPO = 'esmeralda_equipo';

const RUTA_SESION = `/${PREFIJO_API}/auth`; // solo viaja a login/refresh/logout/cambiar-password
const RUTA_EQUIPO = `/${PREFIJO_API}`;
const DURACION_COOKIE_EQUIPO_MS = 400 * 24 * 60 * 60 * 1000; // máximo que aceptan los navegadores

/**
 * Cookies de autenticación. Ambas son httpOnly (el JavaScript de la página no las lee, así un XSS
 * no puede robarlas) y SameSite=Strict (otro sitio no puede usarlas: protege de CSRF).
 *  - esmeralda_sesion: token de renovación; vence con la sesión.
 *  - esmeralda_equipo: token del equipo registrado; se renueva en cada login desde el equipo.
 */
@Injectable()
export class CookiesAutenticacion {
  private readonly base: CookieOptions;

  constructor(@Inject(CONFIGURACION) config: Configuracion) {
    this.base = { httpOnly: true, sameSite: 'strict', secure: config.autenticacion.cookiesSeguras };
  }

  leerSesion(solicitud: Request): string | undefined {
    return leer(solicitud, COOKIE_SESION);
  }

  leerEquipo(solicitud: Request): string | undefined {
    return leer(solicitud, COOKIE_EQUIPO);
  }

  ponerSesion(respuesta: Response, token: string, vence: Date): void {
    respuesta.cookie(COOKIE_SESION, token, { ...this.base, path: RUTA_SESION, expires: vence });
  }

  borrarSesion(respuesta: Response): void {
    respuesta.clearCookie(COOKIE_SESION, { ...this.base, path: RUTA_SESION });
  }

  ponerEquipo(respuesta: Response, token: string): void {
    respuesta.cookie(COOKIE_EQUIPO, token, {
      ...this.base,
      path: RUTA_EQUIPO,
      maxAge: DURACION_COOKIE_EQUIPO_MS,
    });
  }
}

function leer(solicitud: Request, nombre: string): string | undefined {
  const valor: unknown = solicitud.cookies?.[nombre];
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}
