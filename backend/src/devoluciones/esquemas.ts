import { z } from 'zod';
import { cajaElegida } from '../caja/esquemas';
import {
  cantidad,
  enteroDeConsulta,
  fechaDeConsulta,
  idDeCuerpo,
  limiteDeConsulta,
  textoOpcional,
} from '../comun/esquemas';
import { esquemaItem, esquemaPago } from '../ventas/esquemas';

const MENSAJE_NUMERO = 'El número de factura no es válido (ejemplo: LAM-00000012)';
const MENSAJE_TIPO = 'tipo debe ser DEVOLUCION o CAMBIO';
const MENSAJE_ESTADO = 'estado debe ser PENDIENTE, APROBADA, RECHAZADA, EJECUTADA o CANCELADA';
const MENSAJE_ESTADO_PRODUCTO = 'Indique el estado del producto: BUENO o DEFECTUOSO';
const MENSAJE_LINEAS = 'Envíe lo que se devuelve en "lineas": [{ detalle_id, cantidad, estado }]';

const tipo = z
  .string({ error: 'Indique si es una devolución o un cambio (tipo)' })
  .trim()
  .toUpperCase()
  .pipe(z.enum(['DEVOLUCION', 'CAMBIO'], { error: MENSAJE_TIPO }));

/**
 * `?numero=LAM-00000012`: el número de factura, escaneado del QR del ticket o escrito a mano
 * (`lam-12` vale: se completa con ceros).
 */
export const esquemaBuscarVenta = z.object({
  numero: z
    .string('Indique el número de factura (numero)')
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}-\d{1,8}$/, MENSAJE_NUMERO)
    .transform((numero) => {
      const [sucursal, correlativo] = numero.split('-');
      return `${sucursal}-${correlativo.padStart(8, '0')}`;
    }),
});
export type DatosBuscarVenta = z.output<typeof esquemaBuscarVenta>;

/**
 * 1) La solicitud. `detalle_id` es la línea de la factura (viene en la búsqueda de la venta); una
 * línea puede ir dos veces, una parte en buen estado y otra defectuosa. El monto lo calcula la
 * base. No lleva sucursal: es la del equipo de la sesión (`sucursal_id` es solo para el
 * administrador sin equipo registrado).
 */
export const esquemaSolicitarDevolucion = z.object({
  venta_id: idDeCuerpo('Indique la venta (venta_id)'),
  tipo,
  motivo: z
    .string({ error: 'Escriba el motivo de la devolución' })
    .trim()
    .min(5, 'El motivo debe tener al menos 5 caracteres')
    .max(300, 'El motivo es demasiado largo'),
  cliente_nombre: z
    .string({ error: 'Escriba el nombre del cliente' })
    .trim()
    .min(3, 'Escriba el nombre del cliente')
    .max(120, 'El nombre del cliente es demasiado largo'),
  cliente_telefono: z
    .string({ error: 'Escriba el teléfono del cliente' })
    .trim()
    .min(7, 'Escriba el teléfono del cliente (al menos 7 caracteres)')
    .max(20, 'El teléfono del cliente es demasiado largo'),
  lineas: z
    .array(
      z.object({
        detalle_id: idDeCuerpo('Indique la línea de la factura (detalle_id)'),
        cantidad: cantidad('La cantidad debe ser un entero de 1 en adelante'),
        estado: z
          .string({ error: MENSAJE_ESTADO_PRODUCTO })
          .trim()
          .toUpperCase()
          .pipe(z.enum(['BUENO', 'DEFECTUOSO'], { error: MENSAJE_ESTADO_PRODUCTO })),
      }),
      { error: MENSAJE_LINEAS },
    )
    .min(1, 'Indique al menos un producto para devolver')
    .max(100, 'Demasiadas líneas en una sola solicitud'),
  sucursal_id: idDeCuerpo('sucursal_id debe ser el id de una sucursal').optional(),
});
export type DatosSolicitarDevolucion = z.output<typeof esquemaSolicitarDevolucion>;

/** 2) El administrador aprueba o rechaza. Para rechazar hace falta decir por qué. */
export const esquemaResolverDevolucion = z
  .object({
    aprobar: z.boolean({ error: 'Indique "aprobar": true para aprobarla, false para rechazarla' }),
    comentario: textoOpcional(300, 'El comentario es demasiado largo'),
  })
  .refine((datos) => datos.aprobar || (datos.comentario?.length ?? 0) >= 5, {
    path: ['comentario'],
    message: 'Para rechazar la devolución escriba el motivo (al menos 5 caracteres)',
  });
export type DatosResolverDevolucion = z.output<typeof esquemaResolverDevolucion>;

/**
 * 3) La ejecución en caja. Una devolución no lleva nada (`{}`): el turno sale del equipo de la
 * sesión. Un cambio lleva lo que se lleva el cliente, como una venta (sin promoción): `items`,
 * los `pagos` de la diferencia si lo nuevo cuesta más, y la `clave_idempotencia` de esa venta.
 */
export const esquemaEjecutarDevolucion = z.preprocess(
  (cuerpo) => cuerpo ?? {},
  z.object({
    clave_idempotencia: z
      .uuid('clave_idempotencia debe ser un UUID que el POS genera para la venta del cambio')
      .optional(),
    items: z
      .array(esquemaItem, { error: 'Envíe los productos en "items": [{ variante_id, cantidad }]' })
      .max(100, 'Demasiadas líneas en una sola venta')
      .default([]),
    pagos: z
      .array(esquemaPago, { error: 'Envíe los pagos en "pagos": [{ metodo, moneda, monto }]' })
      .max(10, 'Demasiados pagos en una sola venta')
      .default([]),
    notas: textoOpcional(500, 'Las notas son demasiado largas'),
    caja_id: cajaElegida,
  }),
);
export type DatosEjecutarDevolucion = z.output<typeof esquemaEjecutarDevolucion>;

/** La transferencia con que el administrador devolvió lo que no salió de la caja. */
export const esquemaTransferencia = z.object({
  referencia: z
    .string({ error: 'Escriba la referencia de la transferencia' })
    .trim()
    .min(3, 'La referencia debe tener al menos 3 caracteres')
    .max(60, 'La referencia es demasiado larga'),
});
export type DatosTransferencia = z.output<typeof esquemaTransferencia>;

/** Filtros de GET /api/devoluciones. */
export const esquemaFiltroDevoluciones = z.object({
  estado: z
    .string(MENSAJE_ESTADO)
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(['PENDIENTE', 'APROBADA', 'RECHAZADA', 'EJECUTADA', 'CANCELADA'], {
        error: MENSAJE_ESTADO,
      }),
    )
    .optional(),
  tipo: z
    .string(MENSAJE_TIPO)
    .trim()
    .toUpperCase()
    .pipe(z.enum(['DEVOLUCION', 'CAMBIO'], { error: MENSAJE_TIPO }))
    .optional(),
  /** Donde se solicitó o donde se ejecutó. */
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una sucursal').optional(),
  /** Por la fecha de la solicitud (día de Managua). */
  desde: fechaDeConsulta('desde').optional(),
  hasta: fechaDeConsulta('hasta').optional(),
  /** `true`: las ejecutadas a las que todavía les falta la transferencia del administrador. */
  por_transferir: z
    .enum(['true', 'false'], { error: 'por_transferir debe ser true o false' })
    .transform((valor) => valor === 'true')
    .optional(),
  /** Parte del número de la devolución, de la factura o del nombre del cliente. */
  buscar: z
    .string('El texto a buscar no es válido')
    .trim()
    .max(80, 'El texto a buscar es demasiado largo')
    .optional()
    .transform((texto) => texto || undefined),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de una devolución').optional(),
});
export type FiltroDevoluciones = z.output<typeof esquemaFiltroDevoluciones>;
