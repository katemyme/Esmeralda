import { z } from 'zod';
import { ValidacionZod } from './validacion-zod.pipe';

const ID_NO_VALIDO = 'El identificador de la ruta no es válido';

/** `@Param('id', idEntero())`: id numérico de la ruta; si no lo es → 400 DATOS_INVALIDOS. */
export const idEntero = (campo = 'id') =>
  new ValidacionZod(
    z
      .string()
      .regex(/^[1-9]\d{0,14}$/, ID_NO_VALIDO)
      .transform(Number),
    campo,
  );

/** `@Param('id', idUuid())`: id UUID de la ruta (equipos). */
export const idUuid = (campo = 'id') => new ValidacionZod(z.uuid(ID_NO_VALIDO), campo);

/** Número entero positivo que llega como texto en la consulta (`?limite=20`). */
export const enteroDeConsulta = (mensaje: string) =>
  z
    .string(mensaje)
    .regex(/^[1-9]\d{0,14}$/, mensaje)
    .transform(Number);

/** `?limite=`: cuántas filas devolver (por defecto 50, hasta 200). */
export const limiteDeConsulta = () =>
  enteroDeConsulta('limite debe ser un número entre 1 y 200')
    .refine((n) => n <= 200, 'limite debe ser un número entre 1 y 200')
    .default(50);

/** `?desplazamiento=`: paginación por posición, cuántas filas saltar (por defecto 0). */
export const desplazamientoDeConsulta = () =>
  z
    .string('desplazamiento debe ser un número de 0 en adelante')
    .regex(/^\d{1,9}$/, 'desplazamiento debe ser un número de 0 en adelante')
    .transform(Number)
    .default(0);

/** `?desde=2026-10-01`: fecha AAAA-MM-DD en la consulta (día de Managua). */
export const fechaDeConsulta = (campo: string) =>
  z.iso.date(`${campo} debe ser una fecha con el formato AAAA-MM-DD`);

/** Texto opcional: ausente, null o vacío → null. */
export const textoOpcional = (maximo: number, mensajeLargo: string) =>
  z
    .string()
    .trim()
    .max(maximo, mensajeLargo)
    .nullish()
    .transform((valor) => valor || null);

/** Cuerpo de las rutas que activan o desactivan algo: `{ "activo": true }`. */
export const esquemaActivo = z.object({
  activo: z.boolean({ error: 'Indique "activo": true o false' }),
});
export type DatosActivo = z.output<typeof esquemaActivo>;

/** Lo mismo para lo que en la base se llama `activa` (categoría, gama, perforación, promoción). */
export const esquemaActiva = z.object({
  activa: z.boolean({ error: 'Indique "activa": true o false' }),
});
export type DatosActiva = z.output<typeof esquemaActiva>;

/** Id que llega en el cuerpo (`"categoria_id": 3`). */
export const idDeCuerpo = (mensaje: string) => z.number(mensaje).int(mensaje).positive(mensaje);

/**
 * Monto en córdobas que llega en el cuerpo: número o texto, de 0 en adelante y con 2 decimales
 * como máximo. Sale como texto exacto ("650.50"): así viaja a la base (numeric) sin pasar por
 * decimales binarios.
 */
export const monto = (mensaje: string) =>
  z
    .union([z.number(), z.string()], mensaje)
    .transform((valor) => (typeof valor === 'number' ? String(valor) : valor.trim()))
    .refine((texto) => /^\d{1,10}(\.\d{1,2})?$/.test(texto), mensaje);

/** Monto mayor que cero (precios de la tabla de perforaciones, valor de una promoción). */
export const montoPositivo = (mensaje: string) =>
  monto(mensaje).refine((texto) => Number(texto) > 0, mensaje);

/**
 * Como `monto`, pero con hasta 4 decimales: costos unitarios de una factura de compra y tipos de
 * cambio (así los guarda la base).
 */
export const monto4 = (mensaje: string) =>
  z
    .union([z.number(), z.string()], mensaje)
    .transform((valor) => (typeof valor === 'number' ? String(valor) : valor.trim()))
    .refine((texto) => /^\d{1,8}(\.\d{1,4})?$/.test(texto), mensaje);

/** Cantidad de piezas que llega en el cuerpo: entero de `minimo` (por defecto 1) a 100 000. */
export const cantidad = (mensaje: string, minimo = 1) =>
  z.number(mensaje).int(mensaje).min(minimo, mensaje).max(100_000, mensaje);

/** `{ "motivo": "..." }` para cancelar algo: al menos 5 caracteres. */
export const esquemaMotivo = z.object({
  motivo: z
    .string({ error: 'Escriba el motivo' })
    .trim()
    .min(5, 'El motivo debe tener al menos 5 caracteres')
    .max(200, 'El motivo es demasiado largo'),
});
export type DatosMotivo = z.output<typeof esquemaMotivo>;
