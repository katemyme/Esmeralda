import { z } from 'zod';
import { ValidacionZod } from '../comun/validacion-zod.pipe';

/** `@Param('codigo', codigoRol())`: código del rol en la ruta, sin distinguir mayúsculas. */
export const codigoRol = () =>
  new ValidacionZod(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z_]{1,20}$/, 'El código del rol no es válido'),
    'codigo',
  );

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
