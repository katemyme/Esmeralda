import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { BaseDatosService } from './base-datos/base-datos.service';
import { cargarConfiguracion, describirBaseDatos } from './configuracion/configuracion';
import { configurarApp } from './configurar-app';

async function iniciar(): Promise<void> {
  // backend/.env (no pisa variables de entorno ya definidas, p. ej. en el servidor)
  const archivoEnv = join(__dirname, '..', '.env');
  if (existsSync(archivoEnv)) process.loadEnvFile(archivoEnv);

  // Validar antes de levantar Nest para mostrar un error claro si falta configuración
  let config;
  try {
    config = cargarConfiguracion();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const app = configurarApp(await NestFactory.create<NestExpressApplication>(AppModule));
  app.enableShutdownHooks();
  await app.listen(config.puerto);

  const logger = new Logger('Inicio');
  logger.log(`API en http://localhost:${config.puerto}/api (entorno: ${config.entorno})`);
  const baseDatos = describirBaseDatos(config.baseDatos.url);
  if (await app.get(BaseDatosService).verificarConexion()) {
    logger.log(`PostgreSQL conectado: ${baseDatos}`);
  } else {
    logger.warn(`Sin conexión con PostgreSQL (${baseDatos}): revise DATABASE_URL en backend/.env`);
  }
}

void iniciar();
