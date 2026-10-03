import { resolve } from 'node:path';
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
  JWT_SECRETO: z
    .string({ error: 'falta: genere uno con npm run secreto' })
    .min(32, 'debe tener al menos 32 caracteres: genere uno con npm run secreto')
    .refine(
      (v) => !v.includes('CAMBIE'),
      'todavía tiene el valor de ejemplo: genere uno con npm run secreto',
    ),
  LOGIN_LIMITE_POR_MINUTO: z.coerce.number().int().min(1).max(10_000).default(10),
  TRUST_PROXY: z.string().default('false').transform(interpretarTrustProxy),
  DIR_FOTOS: z.string().trim().min(1).default('almacen/fotos'),
});

/**
 * Valor de "trust proxy" de Express: detrás de un proxy (nginx, Caddy) hace falta para conocer la IP
 * real del cliente (bitácora de accesos y límite de intentos). false | true | n.º de saltos | IPs.
 */
function interpretarTrustProxy(valor: string): boolean | number | string {
  const v = valor.trim();
  if (v === '' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  return /^\d+$/.test(v) ? Number(v) : v;
}

export interface Configuracion {
  entorno: 'development' | 'test' | 'production';
  puerto: number;
  baseDatos: {
    url: string;
    maxConexiones: number;
  };
  autenticacion: {
    secretoJwt: string;
    /** Intentos de login (y de cambio de contraseña) por minuto desde una misma IP. */
    limiteLoginPorMinuto: number;
    /** Cookies solo por HTTPS (en producción). */
    cookiesSeguras: boolean;
  };
  trustProxy: boolean | number | string;
  /** Carpeta (ruta absoluta) donde se guardan las fotos subidas de productos y mermas. */
  dirFotos: string;
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
    autenticacion: {
      secretoJwt: e.JWT_SECRETO,
      limiteLoginPorMinuto: e.LOGIN_LIMITE_POR_MINUTO,
      cookiesSeguras: e.NODE_ENV === 'production',
    },
    trustProxy: e.TRUST_PROXY,
    dirFotos: resolve(e.DIR_FOTOS),
  };
}

/** Servidor y base de una URL de conexión, sin usuario ni contraseña (para mostrar en logs). */
export function describirBaseDatos(url: string): string {
  const u = new URL(url);
  return `${u.pathname.slice(1)} en ${u.host}`;
}
