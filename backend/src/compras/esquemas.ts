import { z } from 'zod';
import {
  cantidad,
  enteroDeConsulta,
  fechaDeConsulta,
  idDeCuerpo,
  limiteDeConsulta,
  monto4,
  montoPositivo,
  textoOpcional,
} from '../comun/esquemas';

const MENSAJE_COSTO =
  'El costo unitario debe ser un monto de 0 en adelante, con 4 decimales como máximo';
const MENSAJE_TIPO_CAMBIO =
  'El tipo de cambio debe ser mayor que 0, con 4 decimales como máximo (o vacío para usar el del día)';

const moneda = z
  .string({ error: 'Indique la moneda: USD o NIO' })
  .trim()
  .toUpperCase()
  .pipe(z.enum(['USD', 'NIO'], { error: 'La moneda debe ser USD o NIO' }));

const tipoCambio = monto4(MENSAJE_TIPO_CAMBIO)
  .refine((texto) => Number(texto) > 0, MENSAJE_TIPO_CAMBIO)
  .nullish()
  .transform((valor) => valor ?? null);

/** Una línea de la factura. Si no se indica la cantidad recibida, se toma igual a la facturada. */
export const esquemaLineaCompra = z
  .object({
    variante_id: idDeCuerpo('Indique la pieza (variante_id)'),
    cantidad_facturada: cantidad('La cantidad facturada debe ser un entero de 1 en adelante'),
    /** En la moneda de la factura. */
    costo_unitario: monto4(MENSAJE_COSTO),
    cantidad_recibida: cantidad('La cantidad recibida debe ser un entero de 0 en adelante', 0)
      .nullish()
      .transform((valor) => valor ?? null),
  })
  .refine((l) => l.cantidad_recibida === null || l.cantidad_recibida <= l.cantidad_facturada, {
    message: 'No se puede recibir más de lo facturado',
    path: ['cantidad_recibida'],
  });
export type DatosLineaCompra = z.output<typeof esquemaLineaCompra>;

/** Gasto de importación: se reparte entre las líneas en proporción a su valor. */
export const esquemaGastoCompra = z.object({
  concepto: z
    .string({ error: 'Indique el concepto: COURIER, ADUANA, IMPUESTOS, FLETE u OTRO' })
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(['COURIER', 'ADUANA', 'IMPUESTOS', 'FLETE', 'OTRO'], {
        error: 'El concepto debe ser COURIER, ADUANA, IMPUESTOS, FLETE u OTRO',
      }),
    ),
  moneda,
  monto: montoPositivo('El monto debe ser mayor que 0, con 2 decimales como máximo'),
  descripcion: textoOpcional(200, 'La descripción es demasiado larga'),
  /** Solo en dólares; vacío = el tipo de cambio de la compra. */
  tipo_cambio: tipoCambio,
});
export type DatosGastoCompra = z.output<typeof esquemaGastoCompra>;

const encabezado = {
  proveedor_id: idDeCuerpo('Indique el proveedor (proveedor_id)'),
  factura_numero: z
    .string({ error: 'Escriba el número de la factura' })
    .trim()
    .min(1, 'Escriba el número de la factura')
    .max(40, 'El número de la factura es demasiado largo'),
  fecha_factura: z.iso.date('La fecha de la factura debe tener el formato AAAA-MM-DD'),
  moneda,
  /** Solo en dólares; vacío = el tipo de cambio vigente a la fecha de la factura. */
  tipo_cambio: tipoCambio,
  notas: textoOpcional(500, 'Las notas son demasiado largas'),
};

/** Compra nueva (queda en borrador), opcionalmente con sus líneas y gastos: todo o nada. */
export const esquemaCrearCompra = z.object({
  ...encabezado,
  lineas: z
    .array(esquemaLineaCompra, { error: 'Las líneas van en una lista' })
    .max(500, 'Demasiadas líneas en una sola solicitud')
    .default([]),
  gastos: z
    .array(esquemaGastoCompra, { error: 'Los gastos van en una lista' })
    .max(50, 'Demasiados gastos en una sola solicitud')
    .default([]),
});
export type DatosCrearCompra = z.output<typeof esquemaCrearCompra>;

export const esquemaActualizarCompra = z.object(encabezado);
export type DatosActualizarCompra = z.output<typeof esquemaActualizarCompra>;

/** Filtros de GET /api/compras. */
export const esquemaFiltroCompras = z.object({
  estado: z
    .string('estado debe ser BORRADOR, CONFIRMADA o CANCELADA')
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(['BORRADOR', 'CONFIRMADA', 'CANCELADA'], {
        error: 'estado debe ser BORRADOR, CONFIRMADA o CANCELADA',
      }),
    )
    .optional(),
  proveedor_id: enteroDeConsulta('proveedor_id debe ser el id de un proveedor').optional(),
  /** Por fecha de la factura. */
  desde: fechaDeConsulta('desde').optional(),
  hasta: fechaDeConsulta('hasta').optional(),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de una compra').optional(),
});
export type FiltroCompras = z.output<typeof esquemaFiltroCompras>;
