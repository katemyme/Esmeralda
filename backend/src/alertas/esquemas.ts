import { z } from 'zod';
import { enteroDeConsulta } from '../comun/esquemas';

/** Filtros de GET /api/alertas (llegan como texto en la consulta). */
export const esquemaFiltroAlertas = z.object({
  estado: z
    .enum(['pendientes', 'atendidas', 'todas'], {
      error: 'estado debe ser pendientes, atendidas o todas',
    })
    .default('pendientes'),
  tipo: z
    .string('El tipo de alerta no es válido')
    .trim()
    .toUpperCase()
    .regex(/^[A-Z_]{1,30}$/, 'El tipo de alerta no es válido')
    .optional(),
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una sucursal').optional(),
  /** Paginación: devuelve las alertas anteriores (más viejas) a la de este id. */
  antes_de: enteroDeConsulta('antes_de debe ser el id de una alerta').optional(),
  limite: enteroDeConsulta('limite debe ser un número entre 1 y 200')
    .refine((n) => n <= 200, 'limite debe ser un número entre 1 y 200')
    .default(50),
});
export type FiltroAlertas = z.output<typeof esquemaFiltroAlertas>;
