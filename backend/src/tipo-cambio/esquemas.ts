import { z } from 'zod';
import { monto4 } from '../comun/esquemas';

const MENSAJE = 'usd_a_nio debe ser un monto mayor que 0, con 4 decimales como máximo';

/** Córdobas por dólar de hoy, p. ej. 36.6243. */
export const esquemaTipoCambio = z.object({
  usd_a_nio: monto4(MENSAJE).pipe(z.string().refine((texto) => Number(texto) > 0, MENSAJE)),
});
export type DatosTipoCambio = z.output<typeof esquemaTipoCambio>;
