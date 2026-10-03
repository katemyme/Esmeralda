import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { NoEncontrado } from '../comun/no-encontrado';

/** Un parámetro general del sistema, con lo necesario para editarlo en pantalla. */
export interface ParametroAdmin {
  clave: string;
  valor: string | null;
  /** NUMERO, HORA (HH:MM), OPCION (una de `opciones`) o TEXTO. */
  tipo_valor: string;
  opciones: string[] | null;
  permite_vacio: boolean;
  /** Valor más bajo que acepta un NUMERO (null: de 0 en adelante). */
  minimo: string | null;
  descripcion: string;
  updated_at: Date;
}

/** Parámetros generales. El permiso y el formato de cada valor los valida la base (fn_set_parametro). */
@Injectable()
export class ParametrosService {
  constructor(private readonly bd: BaseDatosService) {}

  listar(): Promise<ParametroAdmin[]> {
    return this.consulta().orderBy('clave').execute();
  }

  async cambiar(adminId: number, clave: string, valor: string | null): Promise<ParametroAdmin> {
    await this.bd.transaccion(adminId, (trx) =>
      sql`select fn_set_parametro(${adminId}, ${clave}, ${valor})`.execute(trx),
    );
    const parametro = await this.consulta().where('clave', '=', clave).executeTakeFirst();
    if (!parametro) throw new NoEncontrado(`El parámetro ${clave} no existe`);
    return parametro;
  }

  private consulta() {
    return this.bd.db
      .selectFrom('parametro')
      .select([
        'clave',
        'valor',
        'tipo_valor',
        'opciones',
        'permite_vacio',
        'minimo',
        'descripcion',
        'updated_at',
      ]);
  }
}
