import { z } from 'zod';
import { textoOpcional } from '../comun/esquemas';

const MENSAJE_PREFIJO =
  'El prefijo de los códigos lleva de 2 a 5 letras, sin tildes, números ni espacios (p. ej. PTI)';

/** El prefijo de los códigos de las piezas de la categoría: PTI → PTI-00001. */
const prefijo = z
  .string({ error: 'Indique el prefijo de los códigos de la categoría (p. ej. PTI)' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,5}$/, MENSAJE_PREFIJO);

const categoria = {
  nombre: z
    .string({ error: 'Escriba el nombre de la categoría' })
    .trim()
    .min(2, 'El nombre de la categoría debe tener al menos 2 caracteres')
    .max(60, 'El nombre de la categoría es demasiado largo'),
  descripcion: textoOpcional(200, 'La descripción es demasiado larga'),
};

/** Categoría nueva: lleva siempre el prefijo de los códigos de sus piezas. */
export const esquemaCategoria = z.object({ ...categoria, prefijo });
export type DatosCategoria = z.output<typeof esquemaCategoria>;

/**
 * Edición: sin prefijo (o null) se deja el que tiene. La base no deja cambiarlo si la categoría ya
 * dio códigos.
 */
export const esquemaEditarCategoria = z.object({
  ...categoria,
  prefijo: prefijo.nullish().transform((valor) => valor ?? null),
});
export type DatosEditarCategoria = z.output<typeof esquemaEditarCategoria>;

/** Cuerpo de la casilla "admite devolución": `{ "admite_devolucion": true }`. */
export const esquemaAdmiteDevolucion = z.object({
  admite_devolucion: z.boolean({ error: 'Indique "admite_devolucion": true o false' }),
});
export type DatosAdmiteDevolucion = z.output<typeof esquemaAdmiteDevolucion>;
