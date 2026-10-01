import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { CONFIGURACION, type Configuracion } from './configuracion/configuracion';

export const PREFIJO_API = 'api';

/** Ajustes comunes de la aplicación HTTP; los usan main.ts y las pruebas e2e. */
export function configurarApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<Configuracion>(CONFIGURACION);
  app.setGlobalPrefix(PREFIJO_API);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(cookieParser());
  return app;
}
