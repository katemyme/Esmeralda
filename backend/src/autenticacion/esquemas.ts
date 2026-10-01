import { z } from 'zod';

export const esquemaLogin = z.object({
  username: z
    .string({ error: 'Escriba su usuario' })
    .trim()
    .toLowerCase()
    .min(1, 'Escriba su usuario')
    .max(40, 'El usuario es demasiado largo'),
  password: z
    .string({ error: 'Escriba su contraseña' })
    .min(1, 'Escriba su contraseña')
    .max(128, 'La contraseña es demasiado larga'),
});
export type DatosLogin = z.output<typeof esquemaLogin>;

/** Política de contraseñas. La base nunca ve el texto plano, por eso se valida aquí. */
export const esquemaPasswordNueva = z
  .string({ error: 'Escriba la nueva contraseña' })
  .min(8, 'La nueva contraseña debe tener al menos 8 caracteres')
  .max(128, 'La nueva contraseña es demasiado larga')
  .regex(/\p{L}/u, 'La nueva contraseña debe incluir al menos una letra')
  .regex(/\d/, 'La nueva contraseña debe incluir al menos un número');

export const esquemaCambioPassword = z.object({
  password_actual: z
    .string({ error: 'Escriba su contraseña actual' })
    .min(1, 'Escriba su contraseña actual')
    .max(128, 'La contraseña es demasiado larga'),
  password_nueva: esquemaPasswordNueva,
});
export type DatosCambioPassword = z.output<typeof esquemaCambioPassword>;
