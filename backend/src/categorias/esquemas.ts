import { z } from 'zod';
import { textoOpcional } from '../comun/esquemas';

export const esquemaCategoria = z.object({
  nombre: z
    .string({ error: 'Escriba el nombre de la categoría' })
    .trim()
    .min(2, 'El nombre de la categoría debe tener al menos 2 caracteres')
    .max(60, 'El nombre de la categoría es demasiado largo'),
  descripcion: textoOpcional(200, 'La descripción es demasiado larga'),
});
export type DatosCategoria = z.output<typeof esquemaCategoria>;

/** Cuerpo de la casilla "admite devolución": `{ "admite_devolucion": true }`. */
export const esquemaAdmiteDevolucion = z.object({
  admite_devolucion: z.boolean({ error: 'Indique "admite_devolucion": true o false' }),
});
export type DatosAdmiteDevolucion = z.output<typeof esquemaAdmiteDevolucion>;
