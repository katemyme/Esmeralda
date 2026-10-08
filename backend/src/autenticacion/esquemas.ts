import { z } from 'zod';
import { idDeCuerpo } from '../comun/esquemas';

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

const SECUENCIAS = '0123456789876543210';

/**
 * PIN de 4 dígitos para el cambio rápido en un equipo registrado. La base nunca lo ve en texto
 * plano, por eso su forma se valida aquí: no vale el mismo dígito cuatro veces ni una escalera.
 */
export const esquemaPinNuevo = z
  .string({ error: 'Escriba un PIN de 4 dígitos' })
  .regex(/^\d{4}$/, 'El PIN debe tener exactamente 4 dígitos')
  .refine(
    (pin) => !/^(\d)\1{3}$/.test(pin) && !SECUENCIAS.includes(pin),
    'Ese PIN es muy fácil de adivinar: no use 0000, 1234 ni parecidos',
  );

/** Crear o cambiar el PIN propio: lo confirma con su contraseña. */
export const esquemaCrearPin = z.object({
  password_actual: z
    .string({ error: 'Escriba su contraseña' })
    .min(1, 'Escriba su contraseña')
    .max(128, 'La contraseña es demasiado larga'),
  pin: esquemaPinNuevo,
});
export type DatosCrearPin = z.output<typeof esquemaCrearPin>;

/** Entrar con PIN: quién (de la lista de la pantalla de bloqueo) y su PIN. */
export const esquemaEntrarConPin = z.object({
  usuario_id: idDeCuerpo('Indique quién entra (usuario_id)'),
  pin: z.string({ error: 'Escriba su PIN' }).regex(/^\d{4}$/, 'El PIN tiene 4 dígitos'),
});
export type DatosEntrarConPin = z.output<typeof esquemaEntrarConPin>;
