import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';

/** Error de arranque ya explicado en español: se muestra sin la traza técnica. */
export class ErrorDeArranque extends Error {}

/** Mensaje claro para los errores comunes al abrir el puerto HTTP, o null si no es uno de ellos. */
export function explicarErrorAlEscuchar(error: unknown, puerto: number): string | null {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'EADDRINUSE':
      return (
        `El puerto ${puerto} ya está en uso: cierre el otro servidor ` +
        '(¿quedó abierto en otra terminal?) o cambie PORT en backend/.env'
      );
    case 'EACCES':
      return (
        `Sin permiso para usar el puerto ${puerto} (puede estar reservado por el sistema): ` +
        'cambie PORT en backend/.env'
      );
    default:
      return null;
  }
}

/**
 * Crea la API y la pone a escuchar en `puerto` (0 = cualquiera libre). Si el puerto no se puede
 * abrir, libera lo que alcanzó a abrir (conexiones a PostgreSQL) y lanza un ErrorDeArranque.
 */
export async function levantarApi(
  puerto: number,
  opciones: NestApplicationOptions = {},
): Promise<NestExpressApplication> {
  const app = configurarApp(await NestFactory.create<NestExpressApplication>(AppModule, opciones));
  app.enableShutdownHooks();
  try {
    await app.listen(puerto);
  } catch (error) {
    await app.close();
    const explicacion = explicarErrorAlEscuchar(error, puerto);
    throw explicacion ? new ErrorDeArranque(explicacion, { cause: error }) : error;
  }
  return app;
}
