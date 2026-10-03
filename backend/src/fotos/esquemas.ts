import { z } from 'zod';
import { textoOpcional } from '../comun/esquemas';
import { esFotoSubida } from './fotos.service';

/**
 * `foto_url` opcional: una foto subida al sistema (/api/fotos/...) o una dirección web. Solo
 * http(s): la dirección termina en una <img> o en un enlace, y ahí no debe caber un `javascript:`.
 */
export const esquemaFotoUrl = textoOpcional(
  300,
  'La dirección de la foto es demasiado larga',
).refine(
  (valor) =>
    valor === null ||
    esFotoSubida(valor) ||
    z.url({ protocol: /^https?$/ }).safeParse(valor).success,
  'La foto debe ser una imagen subida al sistema o una dirección web (http o https)',
);
