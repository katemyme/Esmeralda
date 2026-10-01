import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';

/** Levanta la API completa contra la base de pruebas (sin logs). */
export async function crearApp(
  opciones: {
    controladores?: Type[];
    configurar?: (constructor: TestingModuleBuilder) => void;
  } = {},
): Promise<NestExpressApplication> {
  const constructor = Test.createTestingModule({
    imports: [AppModule],
    controllers: opciones.controladores ?? [],
  });
  opciones.configurar?.(constructor);
  const modulo = await constructor.compile();
  const app = configurarApp(
    modulo.createNestApplication<NestExpressApplication>({ logger: false }),
  );
  await app.init();
  return app;
}

/** Una cookie que la respuesta pone con Set-Cookie: su valor y sus atributos (HttpOnly, Path...). */
export function cookiePuesta(
  respuesta: Response,
  nombre: string,
): { valor: string; atributos: string } | undefined {
  const lineas = ([] as string[]).concat(respuesta.headers['set-cookie'] ?? []);
  const linea = lineas.find((l) => l.startsWith(`${nombre}=`));
  if (!linea) return undefined;
  const [par, ...atributos] = linea.split(';');
  return {
    valor: decodeURIComponent(par.slice(nombre.length + 1)),
    atributos: atributos.map((a) => a.trim()).join('; '),
  };
}
