import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { traducirError } from './errores';

/** Filtro global: toda respuesta de error sale como { codigo, mensaje } en español. */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(error: unknown, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const solicitud = contexto.getRequest<Request>();
    const respuesta = contexto.getResponse<Response>();
    const { estado, cuerpo } = traducirError(error);

    if (estado >= 500) {
      this.logger.error(
        `${solicitud.method} ${solicitud.originalUrl} → ${estado} ${cuerpo.codigo}`,
        (error as { stack?: string } | null)?.stack ?? String(error),
      );
    }
    respuesta.status(estado).json(cuerpo);
  }
}
