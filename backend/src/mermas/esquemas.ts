import { z } from 'zod';
import {
  cantidad,
  enteroDeConsulta,
  idDeCuerpo,
  limiteDeConsulta,
  textoOpcional,
} from '../comun/esquemas';
import { esquemaFotoUrl } from '../fotos/esquemas';

/** La sucursal reporta la pieza dañada o perdida; el stock no baja hasta que el admin la apruebe. */
export const esquemaReportarMerma = z.object({
  sucursal_id: idDeCuerpo('Indique la ubicación (sucursal_id)'),
  variante_id: idDeCuerpo('Indique la pieza (variante_id)'),
  cantidad: cantidad('La cantidad debe ser un entero de 1 en adelante'),
  motivo: z
    .string({ error: 'Explique qué pasó con la pieza (motivo)' })
    .trim()
    .min(5, 'El motivo debe tener al menos 5 caracteres')
    .max(200, 'El motivo es demasiado largo'),
  /** Foto de la pieza: súbala antes con POST /api/fotos. */
  foto_url: esquemaFotoUrl,
});
export type DatosReportarMerma = z.output<typeof esquemaReportarMerma>;

export const esquemaResolverMerma = z.object({
  aprobar: z.boolean({ error: 'Indique "aprobar": true para descontarla, false para rechazarla' }),
  comentario: textoOpcional(200, 'El comentario es demasiado largo'),
});
export type DatosResolverMerma = z.output<typeof esquemaResolverMerma>;

/** Filtros de GET /api/mermas. */
export const esquemaFiltroMermas = z.object({
  estado: z
    .string('estado debe ser PENDIENTE, APROBADA o RECHAZADA')
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(['PENDIENTE', 'APROBADA', 'RECHAZADA'], {
        error: 'estado debe ser PENDIENTE, APROBADA o RECHAZADA',
      }),
    )
    .optional(),
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una ubicación').optional(),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de una merma').optional(),
});
export type FiltroMermas = z.output<typeof esquemaFiltroMermas>;
