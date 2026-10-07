import { z } from 'zod';
import { cajaElegida, codigoMetodoPago, moneda } from '../caja/esquemas';
import {
  cantidad,
  enteroDeConsulta,
  fechaDeConsulta,
  idDeCuerpo,
  limiteDeConsulta,
  monto,
  montoPositivo,
  textoOpcional,
} from '../comun/esquemas';

const MENSAJE_ESTADO = 'estado debe ser COMPLETADA o ANULADA';
const MENSAJE_PIEZAS = 'Envíe en "piezas" los ids de las piezas escaneadas del paquete (de 1 a 10)';

/**
 * Una línea de la venta. El precio de lista lo pone la base; `precio` es opcional y solo sirve
 * para cobrar más (nunca menos). Un paquete (perforación + pieza) lleva cantidad 1 y las piezas
 * que se escanearon.
 */
const esquemaItem = z.object({
  variante_id: idDeCuerpo('Indique el producto (variante_id)'),
  cantidad: cantidad('La cantidad debe ser un entero de 1 en adelante'),
  precio: monto(
    'El precio debe ser un monto de 0 en adelante, con 2 decimales como máximo',
  ).optional(),
  piezas: z
    .array(idDeCuerpo(MENSAJE_PIEZAS), { error: MENSAJE_PIEZAS })
    .min(1, MENSAJE_PIEZAS)
    .max(10, MENSAJE_PIEZAS)
    .optional(),
});

/** Un pago: una venta puede llevar varios (mixto). El vuelto lo calcula la base. */
const esquemaPago = z.object({
  metodo: codigoMetodoPago,
  moneda: moneda.default('NIO'),
  monto: montoPositivo('El monto de cada pago debe ser mayor que 0, con 2 decimales como máximo'),
  /** Número de voucher o de transferencia (obligatorio según el método). */
  referencia: textoOpcional(60, 'La referencia es demasiado larga'),
});

/**
 * Venta del POS. No lleva sucursal, caja ni turno: salen del equipo registrado de la sesión
 * (`caja_id` es solo para el administrador sin caja en su equipo). `clave_idempotencia` es el UUID
 * que el POS genera para cada venta: si la misma solicitud llega dos veces, no se duplica.
 */
export const esquemaRegistrarVenta = z.object({
  clave_idempotencia: z.uuid(
    'clave_idempotencia debe ser un UUID que el POS genera para cada venta',
  ),
  items: z
    .array(esquemaItem, { error: 'Envíe los productos en "items": [{ variante_id, cantidad }]' })
    .min(1, 'La venta debe tener al menos un producto')
    .max(100, 'Demasiadas líneas en una sola venta'),
  pagos: z
    .array(esquemaPago, { error: 'Envíe los pagos en "pagos": [{ metodo, moneda, monto }]' })
    .min(1, 'La venta debe tener al menos un pago')
    .max(10, 'Demasiados pagos en una sola venta'),
  promocion_id: idDeCuerpo('promocion_id debe ser el id de una promoción')
    .nullish()
    .transform((id) => id ?? null),
  cliente_nombre: textoOpcional(120, 'El nombre del cliente es demasiado largo'),
  cliente_telefono: textoOpcional(20, 'El teléfono del cliente es demasiado largo'),
  notas: textoOpcional(500, 'Las notas son demasiado largas'),
  caja_id: cajaElegida,
});
export type DatosRegistrarVenta = z.output<typeof esquemaRegistrarVenta>;

/** Filtros de GET /api/ventas. */
export const esquemaFiltroVentas = z.object({
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una sucursal').optional(),
  turno_id: enteroDeConsulta('turno_id debe ser el id de un turno').optional(),
  vendedor_id: enteroDeConsulta('vendedor_id debe ser el id de un usuario').optional(),
  estado: z
    .string(MENSAJE_ESTADO)
    .trim()
    .toUpperCase()
    .pipe(z.enum(['COMPLETADA', 'ANULADA'], { error: MENSAJE_ESTADO }))
    .optional(),
  desde: fechaDeConsulta('desde').optional(),
  hasta: fechaDeConsulta('hasta').optional(),
  /** Parte del número de factura o del nombre del cliente. */
  buscar: z
    .string('El texto a buscar no es válido')
    .trim()
    .max(80, 'El texto a buscar es demasiado largo')
    .optional()
    .transform((texto) => texto || undefined),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de una venta').optional(),
});
export type FiltroVentas = z.output<typeof esquemaFiltroVentas>;
