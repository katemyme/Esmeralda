import { z } from 'zod';
import { monto4 } from '../comun/esquemas';

const MENSAJE = 'usd_a_nio debe ser un monto mayor que 0, con 4 decimales como máximo';

/**
 * Córdobas por dólar de hoy, p. ej. 36.6243. `confirmar: true` es la confirmación explícita para
 * registrar un valor que se aleja del último más de lo que permite TIPO_CAMBIO_VARIACION_MAX.
 */
export const esquemaTipoCambio = z.object({
  usd_a_nio: monto4(MENSAJE).pipe(z.string().refine((texto) => Number(texto) > 0, MENSAJE)),
  confirmar: z.boolean({ error: 'confirmar debe ser true o false' }).default(false),
});
export type DatosTipoCambio = z.output<typeof esquemaTipoCambio>;
