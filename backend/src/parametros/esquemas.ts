import { z } from 'zod';
import { ValidacionZod } from '../comun/validacion-zod.pipe';

/** `@Param('clave', claveParametro())`: clave del parámetro en la ruta, sin distinguir mayúsculas. */
export const claveParametro = () =>
  new ValidacionZod(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{1,40}$/, 'La clave del parámetro no es válida'),
    'clave',
  );

/**
 * Nuevo valor: texto o número, o null para dejarlo vacío (solo si el parámetro lo permite).
 * El formato según el tipo (número, hora, opción) lo valida la base.
 */
export const esquemaValorParametro = z.object({
  valor: z
    .union([z.string().max(200, 'El valor es demasiado largo'), z.number()], {
      error: 'Envíe "valor": un texto, un número, o null para dejarlo vacío',
    })
    .nullable()
    .transform((valor) => (valor === null ? null : String(valor))),
});
export type DatosValorParametro = z.output<typeof esquemaValorParametro>;
