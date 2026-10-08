import { z } from 'zod';
import { enteroDeConsulta, fechaDeConsulta } from '../comun/esquemas';
import { diasDelRango } from './periodo';

/** Un año de datos por reporte: más que eso se pide en varias partes. */
const MAX_DIAS = 366;

const formato = z
  .enum(['json', 'xlsx', 'pdf'], { error: 'formato debe ser json, xlsx o pdf' })
  .default('json');
const sucursalId = enteroDeConsulta('sucursal_id debe ser el id de una sucursal').optional();

/**
 * Qué días abarca el reporte. Dos formas:
 * - `periodo=dia|semana|mes` y, si se quiere, `fecha` (un día de ese periodo; por defecto hoy):
 *   el reporte diario, el semanal (de lunes a domingo) y el mensual.
 * - `desde` y `hasta`, para un rango cualquiera.
 * Sin nada, el día de hoy.
 */
const rango = {
  periodo: z
    .enum(['dia', 'semana', 'mes'], { error: 'periodo debe ser dia, semana o mes' })
    .optional(),
  fecha: fechaDeConsulta('fecha').optional(),
  desde: fechaDeConsulta('desde').optional(),
  hasta: fechaDeConsulta('hasta').optional(),
};

interface FiltroRango {
  periodo?: string;
  fecha?: string;
  desde?: string;
  hasta?: string;
}

function validarRango(filtro: FiltroRango, contexto: z.RefinementCtx): void {
  const error = (campo: string, mensaje: string) =>
    contexto.addIssue({ code: 'custom', path: [campo], message: mensaje });
  if (!filtro.desde && !filtro.hasta) return;
  if (!filtro.desde || !filtro.hasta) {
    error(filtro.desde ? 'hasta' : 'desde', 'Indique desde y hasta juntos');
    return;
  }
  if (filtro.periodo || filtro.fecha) {
    error(filtro.periodo ? 'periodo' : 'fecha', 'Use periodo y fecha, o desde y hasta: no los dos');
  }
  if (filtro.hasta < filtro.desde) {
    error('hasta', 'hasta no puede ser anterior a desde');
  } else if (diasDelRango({ desde: filtro.desde, hasta: filtro.hasta }) > MAX_DIAS) {
    error('hasta', `El rango no puede pasar de ${MAX_DIAS} días`);
  }
}

/** Filtros de los reportes de un rango de días: `?periodo=&fecha=&desde=&hasta=&sucursal_id=&formato=`. */
export const esquemaReporte = z
  .object({ ...rango, sucursal_id: sucursalId, formato })
  .superRefine(validarRango);
export type FiltroReporte = z.output<typeof esquemaReporte>;

/** Ventas por periodo: además, `agrupar=dia|semana|mes` (cómo se parte el rango en filas). */
export const esquemaReporteVentas = z
  .object({
    ...rango,
    sucursal_id: sucursalId,
    formato,
    agrupar: z
      .enum(['dia', 'semana', 'mes'], { error: 'agrupar debe ser dia, semana o mes' })
      .default('dia'),
  })
  .superRefine(validarRango);
export type FiltroReporteVentas = z.output<typeof esquemaReporteVentas>;

/** Productos más vendidos: además, `limite` (cuántos; por defecto 20, hasta 200). */
export const esquemaReporteProductos = z
  .object({
    ...rango,
    sucursal_id: sucursalId,
    formato,
    limite: enteroDeConsulta('limite debe ser un número entre 1 y 200')
      .refine((n) => n <= 200, 'limite debe ser un número entre 1 y 200')
      .default(20),
  })
  .superRefine(validarRango);
export type FiltroReporteProductos = z.output<typeof esquemaReporteProductos>;

/** Compras por proveedor: el rango va por la fecha de la factura; no lleva sucursal (todas entran a la bodega). */
export const esquemaReporteCompras = z.object({ ...rango, formato }).superRefine(validarRango);
export type FiltroReporteCompras = z.output<typeof esquemaReporteCompras>;

/** Reportes que son una foto de este momento (por reponer): `?sucursal_id=&formato=`. */
export const esquemaReporteActual = z.object({ sucursal_id: sucursalId, formato });
export type FiltroReporteActual = z.output<typeof esquemaReporteActual>;

/** Inventario valorizado: el de hoy o, con `mes=AAAA-MM`, la foto del cierre de ese mes. */
export const esquemaInventarioValorizado = z.object({
  sucursal_id: sucursalId,
  formato,
  mes: z
    .string('mes debe tener el formato AAAA-MM')
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mes debe tener el formato AAAA-MM')
    .optional(),
});
export type FiltroInventarioValorizado = z.output<typeof esquemaInventarioValorizado>;
