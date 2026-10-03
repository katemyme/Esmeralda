import { z } from 'zod';
import { monto, montoPositivo, textoOpcional } from '../comun/esquemas';

const MENSAJE_VALOR = 'El valor debe ser mayor que 0, con 2 decimales como máximo';
const MENSAJE_FECHA = 'La fecha debe tener el formato AAAA-MM-DD';
const MENSAJE_SUBTOTAL = 'subtotal debe ser un monto de 0 en adelante';

/** Fecha opcional: ausente, null o vacía → sin límite. */
const fechaOpcional = z
  .union([z.iso.date(MENSAJE_FECHA), z.literal('')], MENSAJE_FECHA)
  .nullish()
  .transform((fecha) => fecha || null);

/**
 * Promoción: rebaja sobre toda la venta, en porcentaje o en córdobas. Se crea inactiva; el admin
 * la activa aparte. Sin fechas vale siempre que esté activa.
 */
export const esquemaPromocion = z
  .object({
    nombre: z
      .string({ error: 'Escriba el nombre de la promoción' })
      .trim()
      .min(3, 'El nombre de la promoción debe tener al menos 3 caracteres')
      .max(80, 'El nombre de la promoción es demasiado largo'),
    descripcion: textoOpcional(300, 'La descripción es demasiado larga'),
    tipo: z
      .string({ error: 'Indique el tipo: PORCENTAJE o MONTO' })
      .trim()
      .toUpperCase()
      .pipe(z.enum(['PORCENTAJE', 'MONTO'], { error: 'El tipo debe ser PORCENTAJE o MONTO' })),
    valor: montoPositivo(MENSAJE_VALOR),
    compra_minima: monto(
      'La compra mínima debe ser un monto de 0 en adelante, con 2 decimales como máximo',
    ).default('0'),
    vigente_desde: fechaOpcional,
    vigente_hasta: fechaOpcional,
  })
  .refine((d) => d.tipo !== 'PORCENTAJE' || Number(d.valor) <= 100, {
    message: 'Un porcentaje no puede pasar de 100',
    path: ['valor'],
  })
  .refine((d) => !d.vigente_desde || !d.vigente_hasta || d.vigente_desde <= d.vigente_hasta, {
    message: 'La fecha final no puede ser anterior a la inicial',
    path: ['vigente_hasta'],
  });
export type DatosPromocion = z.output<typeof esquemaPromocion>;

/** `?subtotal=1200`: con el subtotal, cada promoción dice si aplica y cuánto descontaría. */
export const esquemaSubtotal = z.object({
  subtotal: z
    .string(MENSAJE_SUBTOTAL)
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, MENSAJE_SUBTOTAL)
    .optional(),
});
export type DatosSubtotal = z.output<typeof esquemaSubtotal>;
