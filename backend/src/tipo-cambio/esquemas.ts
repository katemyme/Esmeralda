import { z } from 'zod';
import { fechaDeConsulta, limiteDeConsulta, monto4 } from '../comun/esquemas';

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

/** Historial: `?desde=&hasta=` (días de Managua) y `?limite=` (por defecto 50, hasta 200). */
export const esquemaHistorialTipoCambio = z
  .object({
    desde: fechaDeConsulta('desde').optional(),
    hasta: fechaDeConsulta('hasta').optional(),
    limite: limiteDeConsulta(),
  })
  .refine((filtro) => !filtro.desde || !filtro.hasta || filtro.desde <= filtro.hasta, {
    path: ['hasta'],
    message: 'hasta no puede ser anterior a desde',
  });
export type FiltroHistorialTipoCambio = z.output<typeof esquemaHistorialTipoCambio>;
