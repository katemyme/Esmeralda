import { z } from 'zod';
import { textoOpcional } from '../comun/esquemas';

/** Sucursal de venta. El código (2 a 5 letras) es el prefijo de sus facturas: LAM-00000001. */
export const esquemaSucursal = z.object({
  codigo: z
    .string({ error: 'Escriba el código de la sucursal' })
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z]{2,5}$/,
      'El código debe tener de 2 a 5 letras, sin tildes ni números (es el prefijo de las facturas)',
    ),
  nombre: z
    .string({ error: 'Escriba el nombre de la sucursal' })
    .trim()
    .min(3, 'El nombre de la sucursal debe tener al menos 3 caracteres')
    .max(80, 'El nombre de la sucursal es demasiado largo'),
  direccion: textoOpcional(200, 'La dirección es demasiado larga'),
  telefono: textoOpcional(20, 'El teléfono es demasiado largo'),
});
export type DatosSucursal = z.output<typeof esquemaSucursal>;

export const esquemaCaja = z.object({
  nombre: z
    .string({ error: 'Escriba el nombre de la caja' })
    .trim()
    .min(2, 'El nombre de la caja debe tener al menos 2 caracteres')
    .max(40, 'El nombre de la caja es demasiado largo'),
});
export type DatosCaja = z.output<typeof esquemaCaja>;
