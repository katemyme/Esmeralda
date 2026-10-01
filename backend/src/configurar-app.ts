import type { NestExpressApplication } from '@nestjs/platform-express';

/** Ajustes comunes de la aplicación HTTP; los usan main.ts y las pruebas e2e. */
export function configurarApp(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  return app;
}
