import { z } from 'zod';
import { enteroDeConsulta, idDeCuerpo, monto, textoOpcional } from '../comun/esquemas';

const MENSAJE_PRECIO = 'El precio debe ser un monto de 0 en adelante, con 2 decimales como máximo';
const MENSAJE_COSTO = 'El costo debe ser un monto de 0 en adelante, con 2 decimales como máximo';
const MENSAJE_GAMA = 'La gama se indica con su id (o null si la pieza no tiene gama)';
const MENSAJE_ATRIBUTOS =
  'Los atributos van como un objeto de hasta 20 datos, p. ej. { "material": "titanio", "calibre": "16G" }';

const sku = z
  .string({ error: 'Escriba el SKU' })
  .trim()
  .toUpperCase()
  .regex(/^\S{1,40}$/, 'El SKU debe tener de 1 a 40 caracteres, sin espacios');

const codigoBarras = textoOpcional(40, 'El código de barras es demasiado largo').refine(
  (valor) => valor === null || !/\s/.test(valor),
  'El código de barras no lleva espacios',
);

// Solo http(s): la dirección termina en una <img> o un enlace del POS
const fotoUrl = textoOpcional(300, 'La dirección de la foto es demasiado larga').refine(
  (valor) => valor === null || z.url({ protocol: /^https?$/ }).safeParse(valor).success,
  'La foto debe ser una dirección web (http o https)',
);

const atributos = z
  .record(
    z.string().trim().min(1, MENSAJE_ATRIBUTOS).max(40, MENSAJE_ATRIBUTOS),
    z.union([z.string().max(100), z.number(), z.boolean()], MENSAJE_ATRIBUTOS),
    MENSAJE_ATRIBUTOS,
  )
  .refine((objeto) => Object.keys(objeto).length <= 20, MENSAJE_ATRIBUTOS);

const nombreProducto = z
  .string({ error: 'Escriba el nombre del producto' })
  .trim()
  .min(2, 'El nombre del producto debe tener al menos 2 caracteres')
  .max(120, 'El nombre del producto es demasiado largo');

/** Variante nueva. Sin nombre queda "Única"; sin costo, 0. */
export const esquemaCrearVariante = z.object({
  sku,
  nombre: textoOpcional(120, 'El nombre de la variante es demasiado largo'),
  precio_venta: monto(MENSAJE_PRECIO),
  costo: monto(MENSAJE_COSTO).default('0'),
  codigo_barras: codigoBarras,
  gama_id: idDeCuerpo(MENSAJE_GAMA)
    .nullish()
    .transform((id) => id ?? null),
  atributos: atributos.default({}),
  foto_url: fotoUrl,
});
export type DatosCrearVariante = z.output<typeof esquemaCrearVariante>;

/**
 * Edición de una variante (sin precio ni costo: eso va por /precio). Se envían todos los datos;
 * la gama y los atributos son obligatorios porque borrarlos por omisión cambiaría cómo se cobra
 * el paquete.
 */
export const esquemaActualizarVariante = z.object({
  sku,
  nombre: textoOpcional(120, 'El nombre de la variante es demasiado largo'),
  codigo_barras: codigoBarras,
  gama_id: idDeCuerpo(MENSAJE_GAMA).nullable(),
  atributos,
  foto_url: fotoUrl,
});
export type DatosActualizarVariante = z.output<typeof esquemaActualizarVariante>;

/** Precio de venta, costo o ambos: lo que no se envía no cambia. */
export const esquemaPrecioVariante = z
  .object({
    precio_venta: monto(MENSAJE_PRECIO).optional(),
    costo: monto(MENSAJE_COSTO).optional(),
  })
  .refine((datos) => datos.precio_venta !== undefined || datos.costo !== undefined, {
    message: 'Envíe precio_venta, costo o ambos',
    path: ['precio_venta'],
  });
export type DatosPrecioVariante = z.output<typeof esquemaPrecioVariante>;

/** Producto nuevo, opcionalmente con sus variantes (todo se crea junto o no se crea nada). */
export const esquemaCrearProducto = z.object({
  categoria_id: idDeCuerpo('Indique la categoría del producto'),
  nombre: nombreProducto,
  descripcion: textoOpcional(500, 'La descripción es demasiado larga'),
  variantes: z
    .array(esquemaCrearVariante, { error: 'Las variantes van en una lista' })
    .max(100, 'Demasiadas variantes en una sola solicitud')
    .default([]),
});
export type DatosCrearProducto = z.output<typeof esquemaCrearProducto>;

export const esquemaActualizarProducto = z.object({
  categoria_id: idDeCuerpo('Indique la categoría del producto'),
  nombre: nombreProducto,
  descripcion: textoOpcional(500, 'La descripción es demasiado larga'),
});
export type DatosActualizarProducto = z.output<typeof esquemaActualizarProducto>;

/** Filtros de GET /api/productos (llegan como texto en la consulta). */
export const esquemaFiltroProductos = z.object({
  /** Parte del nombre del producto o de la variante, del SKU, o el código de barras exacto. */
  buscar: z
    .string('El texto a buscar no es válido')
    .trim()
    .max(80, 'El texto a buscar es demasiado largo')
    .optional()
    .transform((texto) => texto || undefined),
  categoria_id: enteroDeConsulta('categoria_id debe ser el id de una categoría').optional(),
  tipo: z
    .string('tipo debe ser PRODUCTO, SERVICIO o PAQUETE')
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(['PRODUCTO', 'SERVICIO', 'PAQUETE'], {
        error: 'tipo debe ser PRODUCTO, SERVICIO o PAQUETE',
      }),
    )
    .optional(),
  estado: z
    .enum(['activos', 'inactivos', 'todos'], {
      error: 'estado debe ser activos, inactivos o todos',
    })
    .default('activos'),
  limite: enteroDeConsulta('limite debe ser un número entre 1 y 200')
    .refine((n) => n <= 200, 'limite debe ser un número entre 1 y 200')
    .default(50),
  /** Paginación: cuántos productos saltar. */
  desplazamiento: z
    .string('desplazamiento debe ser un número de 0 en adelante')
    .regex(/^\d{1,9}$/, 'desplazamiento debe ser un número de 0 en adelante')
    .transform(Number)
    .default(0),
});
export type FiltroProductos = z.output<typeof esquemaFiltroProductos>;
