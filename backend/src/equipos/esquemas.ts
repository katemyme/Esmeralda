import { z } from 'zod';

export const esquemaRegistroEquipo = z
  .object({
    nombre: z
      .string({ error: 'Escriba un nombre para el equipo' })
      .trim()
      .min(3, 'El nombre del equipo debe tener al menos 3 caracteres')
      .max(60, 'El nombre del equipo es demasiado largo'),
    tipo: z.enum(['CAJA', 'TABLET', 'MOVIL'], { error: 'El tipo debe ser CAJA, TABLET o MOVIL' }),
    sucursal_id: z.number({ error: 'Indique la sucursal del equipo' }).int().positive(),
    caja_id: z.number().int().positive().nullish(),
  })
  .refine((d) => (d.tipo === 'CAJA') === (d.caja_id != null), {
    message: 'Una PC de caja debe indicar su caja (caja_id); una tablet o un celular no la llevan',
    path: ['caja_id'],
  });
export type DatosRegistroEquipo = z.output<typeof esquemaRegistroEquipo>;
