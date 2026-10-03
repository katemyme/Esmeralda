import { z } from 'zod';

/**
 * Gama de pieza. modo_precio: TABLA = el paquete tiene precio fijo por perforación;
 * PIEZA = el paquete cuesta el servicio más el precio de la pieza.
 */
export const esquemaGama = z.object({
  nombre: z
    .string({ error: 'Escriba el nombre de la gama' })
    .trim()
    .min(2, 'El nombre de la gama debe tener al menos 2 caracteres')
    .max(40, 'El nombre de la gama es demasiado largo'),
  modo_precio: z
    .string({ error: 'Indique el modo de precio: TABLA o PIEZA' })
    .trim()
    .toUpperCase()
    .pipe(z.enum(['TABLA', 'PIEZA'], { error: 'El modo de precio debe ser TABLA o PIEZA' })),
  orden: z
    .number({ error: 'El orden debe ser un número entero de 0 a 999' })
    .int('El orden debe ser un número entero de 0 a 999')
    .min(0, 'El orden debe ser un número entero de 0 a 999')
    .max(999, 'El orden debe ser un número entero de 0 a 999')
    .default(0),
});
export type DatosGama = z.output<typeof esquemaGama>;
