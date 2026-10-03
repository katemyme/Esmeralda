import { z } from 'zod';
import { textoOpcional } from '../comun/esquemas';

const nombreCompleto = z
  .string({ error: 'Escriba el nombre completo' })
  .trim()
  .min(3, 'El nombre debe tener al menos 3 caracteres')
  .max(120, 'El nombre es demasiado largo');

// Mismo formato que exige la base (CHECK de usuario.username)
const username = z
  .string({ error: 'Escriba el nombre de usuario' })
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._]{3,40}$/,
    'El usuario debe tener de 3 a 40 caracteres: letras sin tilde, números, punto o guion bajo',
  );

const rol = z
  .string({ error: 'Indique el rol' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z_]{1,20}$/, 'El rol no es válido');

const sucursales = z
  .array(z.number({ error: 'Cada sucursal se indica con su id' }).int().positive(), {
    error: 'Indique las sucursales del usuario (lista de ids; puede ir vacía)',
  })
  .max(50, 'Demasiadas sucursales')
  .transform((ids) => [...new Set(ids)]);

const email = textoOpcional(120, 'El correo es demasiado largo').refine(
  (valor) => valor === null || z.email().safeParse(valor).success,
  'El correo no es válido',
);

const telefono = textoOpcional(20, 'El teléfono es demasiado largo');

export const esquemaCrearUsuario = z.object({
  nombre_completo: nombreCompleto,
  username,
  rol,
  sucursales: sucursales.default([]),
  email,
  telefono,
});
export type DatosCrearUsuario = z.output<typeof esquemaCrearUsuario>;

/** Edición: se envían todos los datos (las sucursales reemplazan a las anteriores). */
export const esquemaActualizarUsuario = z.object({
  nombre_completo: nombreCompleto,
  rol,
  sucursales,
  email,
  telefono,
});
export type DatosActualizarUsuario = z.output<typeof esquemaActualizarUsuario>;
