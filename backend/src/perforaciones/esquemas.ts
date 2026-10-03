import { z } from 'zod';
import { idDeCuerpo, monto, montoPositivo, textoOpcional } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';

const MENSAJE_PRECIO_SERVICIO =
  'El precio de solo servicio debe ser un monto de 0 en adelante, con 2 decimales como máximo';
const MENSAJE_PRECIO_PAQUETE =
  'El precio debe ser un monto mayor que 0, con 2 decimales como máximo (o null para quitarlo)';
const MENSAJE_PIEZAS = 'El paquete lleva de 1 a 4 piezas';

const nombre = z
  .string({ error: 'Escriba el nombre de la perforación' })
  .trim()
  .min(2, 'El nombre de la perforación debe tener al menos 2 caracteres')
  .max(60, 'El nombre de la perforación es demasiado largo');

const piezasPorPaquete = z
  .number({ error: MENSAJE_PIEZAS })
  .int(MENSAJE_PIEZAS)
  .min(1, MENSAJE_PIEZAS)
  .max(4, MENSAJE_PIEZAS);

/** Id opcional en el cuerpo: ausente o null → null. */
const idOpcional = (mensaje: string) =>
  idDeCuerpo(mensaje)
    .nullish()
    .transform((id) => id ?? null);

/** Perforación nueva: el sistema crea sus dos entradas del catálogo (SRV-código y PAQ-código). */
export const esquemaCrearPerforacion = z.object({
  codigo: z
    .string({ error: 'Escriba el código de la perforación' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, 'El código debe tener de 2 a 6 letras, sin tildes ni números'),
  nombre,
  precio_servicio: monto(MENSAJE_PRECIO_SERVICIO),
  piezas_por_paquete: piezasPorPaquete.default(1),
});
export type DatosCrearPerforacion = z.output<typeof esquemaCrearPerforacion>;

export const esquemaActualizarPerforacion = z.object({
  nombre,
  piezas_por_paquete: piezasPorPaquete,
});
export type DatosActualizarPerforacion = z.output<typeof esquemaActualizarPerforacion>;

export const esquemaPrecioServicio = z.object({ precio: monto(MENSAJE_PRECIO_SERVICIO) });
export type DatosPrecioServicio = z.output<typeof esquemaPrecioServicio>;

/** Tabla perforación × gama: precio del paquete con esa gama; null lo quita. */
export const esquemaPrecioGama = z.object({
  gama_id: idDeCuerpo('Indique la gama (gama_id)'),
  precio: montoPositivo(MENSAJE_PRECIO_PAQUETE).nullable(),
});
export type DatosPrecioGama = z.output<typeof esquemaPrecioGama>;

/** Precio especial del paquete con una pieza concreta o con una gama; null lo quita. */
export const esquemaPrecioEspecial = z
  .object({
    variante_id: idOpcional('La pieza se indica con su id (variante_id)'),
    gama_id: idOpcional('La gama se indica con su id (gama_id)'),
    precio: montoPositivo(MENSAJE_PRECIO_PAQUETE).nullable(),
    motivo: textoOpcional(200, 'El motivo es demasiado largo'),
  })
  .refine((d) => (d.variante_id === null) !== (d.gama_id === null), {
    message: 'Indique una pieza (variante_id) o una gama (gama_id), no las dos',
    path: ['variante_id'],
  });
export type DatosPrecioEspecial = z.output<typeof esquemaPrecioEspecial>;

/** Regla de pieza permitida: por gama, por categoría o por pieza. Sin reglas, vale cualquier pieza con gama. */
export const esquemaPiezaPermitida = z
  .object({
    gama_id: idOpcional('La gama se indica con su id (gama_id)'),
    categoria_id: idOpcional('La categoría se indica con su id (categoria_id)'),
    variante_id: idOpcional('La pieza se indica con su id (variante_id)'),
    permitir: z.boolean({
      error: 'Indique "permitir": true para agregar la regla, false para quitarla',
    }),
  })
  .refine(
    (d) => [d.gama_id, d.categoria_id, d.variante_id].filter((id) => id !== null).length === 1,
    {
      message: 'Indique exactamente una: gama_id, categoria_id o variante_id',
      path: ['gama_id'],
    },
  );
export type DatosPiezaPermitida = z.output<typeof esquemaPiezaPermitida>;

/** `?piezas=12,15`: ids de las piezas escaneadas, en una lista separada por comas. */
export const esquemaPiezasPaquete = z.object({
  piezas: z
    .string('Indique las piezas del paquete: ?piezas=12,15 (ids de variante)')
    .regex(
      /^[1-9]\d{0,14}(,[1-9]\d{0,14}){0,3}$/,
      'Indique las piezas del paquete: ?piezas=12,15 (de 1 a 4 ids de variante)',
    )
    .transform((texto) => texto.split(',').map(Number)),
});
export type DatosPiezasPaquete = z.output<typeof esquemaPiezasPaquete>;

/** Para `@Query(...)`. */
export const consultaPiezasPaquete = () => new ValidacionZod(esquemaPiezasPaquete);
