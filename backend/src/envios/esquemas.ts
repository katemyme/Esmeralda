import { z } from 'zod';
import {
  cantidad,
  enteroDeConsulta,
  idDeCuerpo,
  limiteDeConsulta,
  textoOpcional,
} from '../comun/esquemas';

const ESTADOS = [
  'BORRADOR',
  'EN_TRANSITO',
  'RECIBIDO',
  'RECIBIDO_CON_DIFERENCIAS',
  'CANCELADO',
] as const;
const MENSAJE_ESTADO = `estado debe ser ${ESTADOS.join(', ')}`;

const varianteId = idDeCuerpo('Indique la pieza (variante_id)');

/** Línea de un envío en borrador: con cantidad 0 se quita. */
export const esquemaLineaEnvio = z.object({
  variante_id: varianteId,
  cantidad: cantidad('La cantidad debe ser un entero de 0 en adelante (0 quita la pieza)', 0),
});
export type DatosLineaEnvio = z.output<typeof esquemaLineaEnvio>;

/** Envío nuevo (queda en borrador), opcionalmente con sus líneas: todo o nada. */
export const esquemaCrearEnvio = z
  .object({
    origen_id: idDeCuerpo('Indique de dónde sale el envío (origen_id)'),
    destino_id: idDeCuerpo('Indique a dónde va el envío (destino_id)'),
    notas: textoOpcional(500, 'Las notas son demasiado largas'),
    lineas: z
      .array(
        z.object({
          variante_id: varianteId,
          cantidad: cantidad('La cantidad debe ser un entero de 1 en adelante'),
        }),
        { error: 'Las líneas van en una lista' },
      )
      .max(500, 'Demasiadas líneas en una sola solicitud')
      .default([]),
  })
  .refine((e) => e.origen_id !== e.destino_id, {
    message: 'El destino debe ser distinto del origen',
    path: ['destino_id'],
  });
export type DatosCrearEnvio = z.output<typeof esquemaCrearEnvio>;

/**
 * Lo que la sucursal escaneó al recibir. Una pieza puede repetirse (se suma, como al escanear una
 * por una); lo que no se escanee cuenta como no recibido.
 */
export const esquemaRecibirEnvio = z.object({
  recibido: z
    .array(
      z.object({
        variante_id: varianteId,
        cantidad: cantidad('La cantidad recibida debe ser un entero de 0 en adelante', 0),
      }),
      { error: 'Envíe lo escaneado en "recibido": [{ variante_id, cantidad }]' },
    )
    .max(5000, 'Demasiadas piezas en una sola solicitud'),
});
export type DatosRecibirEnvio = z.output<typeof esquemaRecibirEnvio>;

/** Filtros de GET /api/envios. */
export const esquemaFiltroEnvios = z.object({
  estado: z
    .string(MENSAJE_ESTADO)
    .trim()
    .toUpperCase()
    .pipe(z.enum(ESTADOS, { error: MENSAJE_ESTADO }))
    .optional(),
  origen_id: enteroDeConsulta('origen_id debe ser el id de una ubicación').optional(),
  destino_id: enteroDeConsulta('destino_id debe ser el id de una ubicación').optional(),
  limite: limiteDeConsulta(),
  antes_de: enteroDeConsulta('antes_de debe ser el id de un envío').optional(),
});
export type FiltroEnvios = z.output<typeof esquemaFiltroEnvios>;

/** `GET /api/envios/sugerencia?variante_id=&cantidad=`: cómo repartir una pieza entre las sucursales. */
export const esquemaSugerencia = z.object({
  variante_id: enteroDeConsulta('variante_id debe ser el id de una pieza'),
  cantidad: enteroDeConsulta('cantidad debe ser un número entre 1 y 100000').refine(
    (n) => n <= 100_000,
    'cantidad debe ser un número entre 1 y 100000',
  ),
});
export type DatosSugerencia = z.output<typeof esquemaSugerencia>;
