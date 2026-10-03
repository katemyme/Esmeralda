import { z } from 'zod';
import {
  cantidad,
  desplazamientoDeConsulta,
  enteroDeConsulta,
  fechaDeConsulta,
  idDeCuerpo,
  limiteDeConsulta,
  monto,
  textoOpcional,
} from '../comun/esquemas';

const TIPOS_MOVIMIENTO = [
  'ENTRADA',
  'AJUSTE_POSITIVO',
  'ANULACION_VENTA',
  'TRASLADO_ENTRADA',
  'VENTA',
  'AJUSTE_NEGATIVO',
  'MERMA',
  'TRASLADO_SALIDA',
] as const;
const MENSAJE_TIPO = `tipo debe ser uno de: ${TIPOS_MOVIMIENTO.join(', ')}`;

/** Filtros de GET /api/inventario/existencias. */
export const esquemaFiltroExistencias = z.object({
  /** Si no se indica, la ubicación del equipo desde el que se inició la sesión. */
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una ubicación').optional(),
  /** Parte del nombre del producto o de la variante, o del SKU. */
  buscar: z
    .string('El texto a buscar no es válido')
    .trim()
    .max(80, 'El texto a buscar es demasiado largo')
    .optional()
    .transform((texto) => texto || undefined),
  categoria_id: enteroDeConsulta('categoria_id debe ser el id de una categoría').optional(),
  /** `true`: solo lo que está en su stock mínimo o por debajo. */
  solo_bajo_minimo: z
    .enum(['true', 'false'], { error: 'solo_bajo_minimo debe ser true o false' })
    .transform((valor) => valor === 'true')
    .default(false),
  limite: limiteDeConsulta(),
  desplazamiento: desplazamientoDeConsulta(),
});
export type FiltroExistencias = z.output<typeof esquemaFiltroExistencias>;

/** Filtros de GET /api/inventario/movimientos (el kardex). */
export const esquemaFiltroMovimientos = z.object({
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una ubicación').optional(),
  variante_id: enteroDeConsulta('variante_id debe ser el id de una pieza').optional(),
  tipo: z
    .string(MENSAJE_TIPO)
    .trim()
    .toUpperCase()
    .pipe(z.enum(TIPOS_MOVIMIENTO, { error: MENSAJE_TIPO }))
    .optional(),
  desde: fechaDeConsulta('desde').optional(),
  hasta: fechaDeConsulta('hasta').optional(),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de un movimiento').optional(),
});
export type FiltroMovimientos = z.output<typeof esquemaFiltroMovimientos>;

/**
 * Movimiento manual: entrada directa a la bodega (p. ej. inventario inicial), ajuste o merma
 * directa del admin. Ventas, envíos y compras tienen su propia ruta.
 */
export const esquemaMovimiento = z
  .object({
    sucursal_id: idDeCuerpo('Indique la ubicación (sucursal_id)'),
    variante_id: idDeCuerpo('Indique la pieza (variante_id)'),
    tipo: z
      .string({ error: 'Indique el tipo: ENTRADA, AJUSTE_POSITIVO, AJUSTE_NEGATIVO o MERMA' })
      .trim()
      .toUpperCase()
      .pipe(
        z.enum(['ENTRADA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'MERMA'], {
          error: 'El tipo debe ser ENTRADA, AJUSTE_POSITIVO, AJUSTE_NEGATIVO o MERMA',
        }),
      ),
    /** Siempre positiva: el signo lo da el tipo. */
    cantidad: cantidad('La cantidad debe ser un entero de 1 en adelante'),
    motivo: textoOpcional(200, 'El motivo es demasiado largo'),
    /** Solo en una ENTRADA: con él se recalcula el costo promedio de la pieza. */
    costo_unitario: monto(
      'El costo unitario debe ser un monto de 0 en adelante, con 2 decimales como máximo',
    )
      .nullish()
      .transform((valor) => valor ?? null),
  })
  .refine((m) => m.tipo === 'ENTRADA' || (m.motivo !== null && m.motivo.length >= 5), {
    message: 'Explique el motivo del ajuste o de la merma (al menos 5 caracteres)',
    path: ['motivo'],
  })
  .refine((m) => m.tipo === 'ENTRADA' || m.costo_unitario === null, {
    message: 'El costo unitario solo se indica en una ENTRADA',
    path: ['costo_unitario'],
  });
export type DatosMovimiento = z.output<typeof esquemaMovimiento>;

export const esquemaStockMinimo = z.object({
  sucursal_id: idDeCuerpo('Indique la ubicación (sucursal_id)'),
  variante_id: idDeCuerpo('Indique la pieza (variante_id)'),
  stock_minimo: cantidad('El stock mínimo debe ser un entero de 0 en adelante', 0),
});
export type DatosStockMinimo = z.output<typeof esquemaStockMinimo>;
