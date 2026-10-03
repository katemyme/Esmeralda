import { z } from 'zod';
import {
  cantidad,
  enteroDeConsulta,
  idDeCuerpo,
  limiteDeConsulta,
  textoOpcional,
} from '../comun/esquemas';

/** Conteo físico de una ubicación: completo, o solo de una categoría. */
export const esquemaIniciarConteo = z.object({
  sucursal_id: idDeCuerpo('Indique la ubicación (sucursal_id)'),
  categoria_id: idDeCuerpo('La categoría se indica con su id (categoria_id)')
    .nullish()
    .transform((id) => id ?? null),
  notas: textoOpcional(500, 'Las notas son demasiado largas'),
});
export type DatosIniciarConteo = z.output<typeof esquemaIniciarConteo>;

/**
 * Una pieza contada. Por defecto suma 1 (un escaneo = una pieza); con `sumar: false` se fija la
 * cantidad (para corregir o escribir el total de una vez).
 */
export const esquemaRegistrarConteo = z.object({
  variante_id: idDeCuerpo('Indique la pieza (variante_id)'),
  cantidad: cantidad('La cantidad debe ser un entero de 0 en adelante', 0).default(1),
  sumar: z
    .boolean({ error: '"sumar" debe ser true (suma) o false (fija la cantidad)' })
    .default(true),
});
export type DatosRegistrarConteo = z.output<typeof esquemaRegistrarConteo>;

/** Filtros de GET /api/conteos. */
export const esquemaFiltroConteos = z.object({
  estado: z
    .string('estado debe ser ABIERTO, ENVIADO, APLICADO o CANCELADO')
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(['ABIERTO', 'ENVIADO', 'APLICADO', 'CANCELADO'], {
        error: 'estado debe ser ABIERTO, ENVIADO, APLICADO o CANCELADO',
      }),
    )
    .optional(),
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una ubicación').optional(),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de un conteo').optional(),
});
export type FiltroConteos = z.output<typeof esquemaFiltroConteos>;
