import { z } from 'zod';
import { enteroDeConsulta, fechaDeConsulta, limiteDeConsulta } from '../comun/esquemas';

const rango = {
  desde: fechaDeConsulta('desde').optional(),
  hasta: fechaDeConsulta('hasta').optional(),
  limite: limiteDeConsulta(),
  /** Paginación: devuelve los registros anteriores (más viejos) al de este id. */
  antes_de: enteroDeConsulta('antes_de debe ser el id de un registro').optional(),
};

/** Filtros de GET /api/auditoria/cambios. */
export const esquemaFiltroCambios = z.object({
  tabla: z
    .string('La tabla no es válida')
    .trim()
    .toLowerCase()
    .regex(/^[a-z_]{1,40}$/, 'La tabla no es válida')
    .optional(),
  registro_id: z
    .string('registro_id no es válido')
    .trim()
    .min(1, 'registro_id no es válido')
    .max(40, 'registro_id no es válido')
    .optional(),
  usuario_id: enteroDeConsulta('usuario_id debe ser el id de un usuario').optional(),
  accion: z
    .string('accion debe ser INSERT, UPDATE o DELETE')
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(['INSERT', 'UPDATE', 'DELETE'], { error: 'accion debe ser INSERT, UPDATE o DELETE' }),
    )
    .optional(),
  ...rango,
});
export type FiltroCambios = z.output<typeof esquemaFiltroCambios>;

/** Filtros de GET /api/auditoria/accesos. */
export const esquemaFiltroAccesos = z.object({
  usuario_id: enteroDeConsulta('usuario_id debe ser el id de un usuario').optional(),
  /** Nombre de usuario tal como se escribió al intentar entrar (también los que no existen). */
  username: z
    .string('username no es válido')
    .trim()
    .toLowerCase()
    .min(1, 'username no es válido')
    .max(40, 'username no es válido')
    .optional(),
  exito: z
    .enum(['true', 'false'], { error: 'exito debe ser true o false' })
    .transform((valor) => valor === 'true')
    .optional(),
  ...rango,
});
export type FiltroAccesos = z.output<typeof esquemaFiltroAccesos>;
