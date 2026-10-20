import { z } from 'zod';
import { idDeCuerpo } from '../comun/esquemas';
import { CARTA_MM } from './etiquetas-pdf';

/** Una medida en milímetros, con hasta un decimal. */
const milimetros = (campo: string, minimo: number, maximo: number) => {
  const mensaje = `${campo}: de ${minimo} a ${maximo} mm`;
  return z
    .number(mensaje)
    .min(minimo, mensaje)
    .max(maximo, mensaje)
    .transform((n) => Math.round(n * 10) / 10);
};

const entero = (campo: string, minimo: number, maximo: number) => {
  const mensaje = `${campo}: un número entero de ${minimo} a ${maximo}`;
  return z.number(mensaje).int(mensaje).min(minimo, mensaje).max(maximo, mensaje);
};

/**
 * La cuadrícula de la hoja carta. Sin datos, la de las hojas adhesivas más comunes de 30 por hoja
 * (3 columnas × 10 filas de 66.7 × 25.4 mm, como la Avery 5160).
 */
export const esquemaCuadricula = z
  .object({
    filas: entero('Filas', 1, 30).default(10),
    columnas: entero('Columnas', 1, 10).default(3),
    margen_superior: milimetros('Margen de arriba', 0, 100).default(12.7),
    margen_izquierdo: milimetros('Margen de la izquierda', 0, 100).default(4.8),
    ancho: milimetros('Ancho de la etiqueta', 15, 200).default(66.7),
    alto: milimetros('Alto de la etiqueta', 10, 270).default(25.4),
    separacion_horizontal: milimetros('Separación entre columnas', 0, 50).default(3.2),
    separacion_vertical: milimetros('Separación entre filas', 0, 50).default(0),
    saltar: entero('Etiquetas ya usadas de la primera hoja', 0, 299).default(0),
    bordes: z.boolean('Indique "bordes": true o false').default(false),
  })
  .superRefine((c, contexto) => {
    const ancho =
      c.margen_izquierdo + c.columnas * c.ancho + (c.columnas - 1) * c.separacion_horizontal;
    const alto = c.margen_superior + c.filas * c.alto + (c.filas - 1) * c.separacion_vertical;
    // un poco de holgura por el redondeo de las medidas de las hojas (en pulgadas)
    if (ancho > CARTA_MM.ancho + 0.5) {
      contexto.addIssue({
        code: 'custom',
        path: ['columnas'],
        message: `Las columnas no caben a lo ancho de la hoja carta: ocupan ${ancho.toFixed(1)} mm de ${CARTA_MM.ancho}`,
      });
    }
    if (alto > CARTA_MM.alto + 0.5) {
      contexto.addIssue({
        code: 'custom',
        path: ['filas'],
        message: `Las filas no caben a lo alto de la hoja carta: ocupan ${alto.toFixed(1)} mm de ${CARTA_MM.alto}`,
      });
    }
    if (c.saltar >= c.filas * c.columnas) {
      contexto.addIssue({
        code: 'custom',
        path: ['saltar'],
        message: `La hoja tiene ${c.filas * c.columnas} etiquetas: no se pueden saltar ${c.saltar}`,
      });
    }
  });
export type DatosCuadricula = z.output<typeof esquemaCuadricula>;

/** Una etiqueta por página. Sin datos, 50 × 30 mm. */
export const esquemaTamano = z.object({
  ancho: milimetros('Ancho de la etiqueta', 15, 110).default(50),
  alto: milimetros('Alto de la etiqueta', 10, 200).default(30),
});
export type DatosTamano = z.output<typeof esquemaTamano>;

const MENSAJE_COPIAS = 'Copias: un número entero de 1 a 500';

/**
 * `POST /api/etiquetas/pdf`: qué piezas, cuántas copias de cada una y en qué papel. `HOJA` (carta,
 * con `hoja`) o `ROLLO` (una por página, con `rollo`).
 */
export const esquemaPdfEtiquetas = z
  .object({
    formato: z.enum(['HOJA', 'ROLLO'], {
      error: 'El formato es HOJA (carta) o ROLLO (una por página)',
    }),
    piezas: z
      .array(
        z.object({
          variante_id: idDeCuerpo('Cada pieza se indica con su id (variante_id)'),
          copias: z
            .number(MENSAJE_COPIAS)
            .int(MENSAJE_COPIAS)
            .min(1, MENSAJE_COPIAS)
            .max(500, MENSAJE_COPIAS),
        }),
        { error: 'Las piezas van en una lista' },
      )
      .min(1, 'Elija al menos una pieza')
      .max(500, 'Demasiadas piezas en un solo PDF: hágalo por partes'),
    // sin datos, las medidas por defecto (prefault: el objeto vacío pasa por el esquema)
    hoja: esquemaCuadricula.prefault({}),
    rollo: esquemaTamano.prefault({}),
  })
  .refine((datos) => datos.piezas.reduce((suma, p) => suma + p.copias, 0) <= 3000, {
    message: 'Son más de 3000 etiquetas: hágalo por partes',
    path: ['piezas'],
  })
  .refine((datos) => new Set(datos.piezas.map((p) => p.variante_id)).size === datos.piezas.length, {
    message: 'Una pieza aparece dos veces: ponga todas sus copias en una sola',
    path: ['piezas'],
  });
export type DatosPdfEtiquetas = z.output<typeof esquemaPdfEtiquetas>;

/** `GET /api/etiquetas/piezas?texto=`: buscar por nombre, código o código de barras. */
export const esquemaBuscarPiezas = z.object({
  texto: z
    .string('Escriba o escanee lo que busca (texto)')
    .trim()
    .min(1, 'Escriba o escanee lo que busca (texto)')
    .max(80, 'El texto a buscar es demasiado largo'),
});
export type BuscarPiezas = z.output<typeof esquemaBuscarPiezas>;
