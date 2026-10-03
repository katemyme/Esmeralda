import { z } from 'zod';
import { textoOpcional } from '../comun/esquemas';

export const esquemaProveedor = z.object({
  nombre: z
    .string({ error: 'Escriba el nombre del proveedor' })
    .trim()
    .min(2, 'El nombre del proveedor debe tener al menos 2 caracteres')
    .max(120, 'El nombre del proveedor es demasiado largo'),
  pais: textoOpcional(60, 'El país es demasiado largo'),
  /** Moneda en que factura normalmente: se propone al registrar una compra. */
  moneda_habitual: z
    .string({ error: 'Indique la moneda habitual: USD o NIO' })
    .trim()
    .toUpperCase()
    .pipe(z.enum(['USD', 'NIO'], { error: 'La moneda debe ser USD o NIO' }))
    .default('USD'),
  contacto: textoOpcional(120, 'El nombre del contacto es demasiado largo'),
  telefono: textoOpcional(30, 'El teléfono es demasiado largo'),
  email: textoOpcional(120, 'El correo es demasiado largo').refine(
    (valor) => valor === null || z.email().safeParse(valor).success,
    'El correo no es válido',
  ),
});
export type DatosProveedor = z.output<typeof esquemaProveedor>;
