import { HttpException, HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import type { RespuestaError } from './errores';

/**
 * Valida (y normaliza) la entrada con un esquema de Zod: `@Body(new ValidacionZod(esquema))`.
 * Si no cumple responde 400 DATOS_INVALIDOS con un mensaje en español por campo. Para un valor
 * suelto (`@Param('id', new ValidacionZod(esquema, 'id'))`) se indica el nombre del campo.
 */
export class ValidacionZod<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(
    private readonly esquema: T,
    private readonly campo = '',
  ) {}

  transform(valor: unknown): z.output<T> {
    const resultado = this.esquema.safeParse(valor);
    if (resultado.success) return resultado.data;

    const errores = resultado.error.issues.map((problema) => ({
      campo: problema.path.join('.') || this.campo,
      mensaje: problema.message,
    }));
    const cuerpo: RespuestaError = {
      codigo: 'DATOS_INVALIDOS',
      mensaje: errores.length === 1 ? errores[0].mensaje : 'Revise los datos enviados',
      errores,
    };
    throw new HttpException(cuerpo, HttpStatus.BAD_REQUEST);
  }
}
