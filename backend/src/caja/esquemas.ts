import { z } from 'zod';
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

const MENSAJE_MONEDA = 'La moneda debe ser NIO o USD';
const MENSAJE_ESTADO = 'estado debe ser ABIERTO o CERRADO';
const MENSAJE_VALOR = 'Indique el valor del billete o la moneda (mayor que 0)';

/** NIO (córdobas) o USD. */
export const moneda = z
  .string(MENSAJE_MONEDA)
  .trim()
  .toUpperCase()
  .pipe(z.enum(['NIO', 'USD'], { error: MENSAJE_MONEDA }));

/** Código de un método de pago (EFECTIVO, TARJETA, TRANSFERENCIA…): la base dice si existe. */
export const codigoMetodoPago = z
  .string({ error: 'Indique el método de pago' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z_]{1,20}$/, 'El método de pago no es válido');

/**
 * La caja NO se elige: sale del equipo registrado donde se inició la sesión. `caja_id` existe
 * solo para el administrador cuando su equipo no tiene una caja propia; a cualquier otro la base
 * se lo rechaza.
 */
export const cajaElegida = idDeCuerpo('caja_id debe ser el id de una caja').optional();

/** Lo mismo en la consulta de un GET (`?caja_id=3`). */
export const esquemaCajaElegida = z.object({
  caja_id: enteroDeConsulta('caja_id debe ser el id de una caja').optional(),
});
export type CajaElegida = z.output<typeof esquemaCajaElegida>;

/** Apertura: se declara el efectivo que se contó en la gaveta (a ciegas, sin ver el fondo esperado). */
export const esquemaAbrirTurno = z.object({
  inicial_nio: monto(
    'El efectivo inicial en córdobas debe ser un monto de 0 en adelante, con 2 decimales como máximo',
  ).default('0'),
  inicial_usd: monto(
    'El efectivo inicial en dólares debe ser un monto de 0 en adelante, con 2 decimales como máximo',
  ).default('0'),
  caja_id: cajaElegida,
});
export type DatosAbrirTurno = z.output<typeof esquemaAbrirTurno>;

/** Ingreso o egreso de efectivo durante el turno (pago a un proveedor, cambio de billetes…). */
export const esquemaMovimientoCaja = z.object({
  tipo: z
    .string({ error: 'Indique el tipo: INGRESO o EGRESO' })
    .trim()
    .toUpperCase()
    .pipe(z.enum(['INGRESO', 'EGRESO'], { error: 'El tipo debe ser INGRESO o EGRESO' })),
  moneda: moneda.default('NIO'),
  monto: montoPositivo('El monto debe ser mayor que 0, con 2 decimales como máximo'),
  motivo: z
    .string({ error: 'Explique el motivo del movimiento' })
    .trim()
    .min(5, 'El motivo debe tener al menos 5 caracteres')
    .max(200, 'El motivo es demasiado largo'),
  caja_id: cajaElegida,
});
export type DatosMovimientoCaja = z.output<typeof esquemaMovimientoCaja>;

/**
 * Cierre (arqueo ciego): lo que se contó, billete por billete, y los totales de los vouchers y
 * transferencias. Quien cierra nunca envía ni recibe el monto esperado.
 */
export const esquemaCerrarTurno = z.object({
  efectivo: z
    .array(
      z.object({
        moneda,
        // Como lo entrega GET /api/denominaciones ("0.50") o como número
        valor: z
          .union([z.number(), z.string()], MENSAJE_VALOR)
          .transform(Number)
          .refine((n) => Number.isFinite(n) && n > 0, MENSAJE_VALOR),
        cantidad: cantidad('La cantidad debe ser un entero de 0 en adelante', 0),
      }),
      { error: 'Envíe el conteo en "efectivo": [{ moneda, valor, cantidad }]' },
    )
    .max(100, 'Demasiadas denominaciones en una sola solicitud')
    .default([]),
  no_efectivo: z
    .array(
      z.object({
        metodo: codigoMetodoPago,
        monto: monto('El monto debe ser de 0 en adelante, con 2 decimales como máximo'),
      }),
      { error: 'Envíe los vouchers y transferencias en "no_efectivo": [{ metodo, monto }]' },
    )
    .max(20, 'Demasiados métodos de pago en una sola solicitud')
    .default([]),
  /** Efectivo que se retira; lo que queda es el fondo del día siguiente. */
  retiro_nio: monto(
    'El retiro en córdobas debe ser un monto de 0 en adelante, con 2 decimales como máximo',
  ).default('0'),
  retiro_usd: monto(
    'El retiro en dólares debe ser un monto de 0 en adelante, con 2 decimales como máximo',
  ).default('0'),
  /** Obligatoria desde el segundo conteo (solo hay un reconteo) o para cerrar con diferencia. */
  justificacion: textoOpcional(500, 'La justificación es demasiado larga'),
  observaciones: textoOpcional(500, 'Las observaciones son demasiado largas'),
  caja_id: cajaElegida,
});
export type DatosCerrarTurno = z.output<typeof esquemaCerrarTurno>;

/** `{ "motivo": "..." }` del cierre forzado: la base pide al menos 10 caracteres. */
export const esquemaCierreForzado = z.object({
  motivo: z
    .string({ error: 'Explique por qué se cierra el turno sin arqueo' })
    .trim()
    .min(10, 'El motivo debe tener al menos 10 caracteres')
    .max(480, 'El motivo es demasiado largo'),
});
export type DatosCierreForzado = z.output<typeof esquemaCierreForzado>;

/** Filtros de GET /api/turnos. */
export const esquemaFiltroTurnos = z.object({
  sucursal_id: enteroDeConsulta('sucursal_id debe ser el id de una sucursal').optional(),
  estado: z
    .string(MENSAJE_ESTADO)
    .trim()
    .toUpperCase()
    .pipe(z.enum(['ABIERTO', 'CERRADO'], { error: MENSAJE_ESTADO }))
    .optional(),
  /** Por la fecha de apertura (día de Managua). */
  desde: fechaDeConsulta('desde').optional(),
  hasta: fechaDeConsulta('hasta').optional(),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de un turno').optional(),
});
export type FiltroTurnos = z.output<typeof esquemaFiltroTurnos>;
