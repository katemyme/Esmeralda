import { z } from 'zod';
import { textoOpcional } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';

const MENSAJE_CODIGO = 'El código del rol no es válido';

const codigo = z
  .string({ error: 'Escriba el código del rol' })
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z_]{2,20}$/,
    'El código del rol debe tener de 2 a 20 letras o guiones bajos, sin tildes ni espacios',
  );

const nombre = z
  .string({ error: 'Escriba el nombre del rol' })
  .trim()
  .min(3, 'El nombre del rol debe tener al menos 3 caracteres')
  .max(60, 'El nombre del rol es demasiado largo');

/** `@Param('codigo', codigoRol())`: código del rol en la ruta, sin distinguir mayúsculas. */
export const codigoRol = () =>
  new ValidacionZod(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z_]{1,20}$/, MENSAJE_CODIGO),
    'codigo',
  );

/** Rol nuevo: nace sin permisos. */
export const esquemaCrearRol = z.object({
  codigo,
  nombre,
  descripcion: textoOpcional(200, 'La descripción es demasiado larga'),
});
export type DatosCrearRol = z.output<typeof esquemaCrearRol>;

export const esquemaActualizarRol = z.object({
  nombre,
  descripcion: textoOpcional(200, 'La descripción es demasiado larga'),
});
export type DatosActualizarRol = z.output<typeof esquemaActualizarRol>;

/** La lista completa de permisos con la que queda el rol (los que no vayan se le quitan). */
export const esquemaPermisosRol = z.object({
  permisos: z
    .array(
      z
        .string({ error: 'Cada permiso se indica con su código' })
        .trim()
        .toUpperCase()
        .regex(/^[A-Z_]{1,40}$/, 'Código de permiso no válido'),
      { error: 'Envíe la lista completa de permisos del rol' },
    )
    .max(200, 'Demasiados permisos'),
});
export type DatosPermisosRol = z.output<typeof esquemaPermisosRol>;
