import { z } from 'zod';

// Mensajes de validación de Zod en español (aplica a toda la aplicación)
z.config(z.locales.es());

const esquemaEntorno = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'debe ser una URL postgres://usuario:contraseña@servidor:puerto/base',
  }),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export interface Configuracion {
  entorno: 'development' | 'test' | 'production';
  puerto: number;
  baseDatos: {
    url: string;
    maxConexiones: number;
  };
}

/** Token de inyección: `@Inject(CONFIGURACION) config: Configuracion`. */
export const CONFIGURACION = Symbol('CONFIGURACION');

/** Lee y valida las variables de entorno. Lanza un error legible si falta algo o es inválido. */
export function cargarConfiguracion(entorno: NodeJS.ProcessEnv = process.env): Configuracion {
  const resultado = esquemaEntorno.safeParse(entorno);
  if (!resultado.success) {
    throw new Error(
      `Configuración inválida (revise backend/.env):\n${z.prettifyError(resultado.error)}`,
    );
  }
  const e = resultado.data;
  return {
    entorno: e.NODE_ENV,
    puerto: e.PORT,
    baseDatos: { url: e.DATABASE_URL, maxConexiones: e.DB_POOL_MAX },
  };
}

/** Servidor y base de una URL de conexión, sin usuario ni contraseña (para mostrar en logs). */
export function describirBaseDatos(url: string): string {
  const u = new URL(url);
  return `${u.pathname.slice(1)} en ${u.host}`;
}
