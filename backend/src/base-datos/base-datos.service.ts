import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import { CONFIGURACION, type Configuracion } from '../configuracion/configuracion';
import type { DB } from './tipos-bd';
import { tiposPg } from './tipos-pg';

export type Trx = Transaction<DB>;

/**
 * Acceso a PostgreSQL. Las reglas del negocio viven en la base (funciones fn_*, triggers, CHECK):
 * los servicios las invocan dentro de `transaccion()`; las lecturas simples pueden usar `db`.
 */
@Injectable()
export class BaseDatosService implements OnApplicationShutdown {
  private readonly logger = new Logger(BaseDatosService.name);
  readonly db: Kysely<DB>;

  constructor(@Inject(CONFIGURACION) config: Configuracion) {
    const pool = new Pool({
      connectionString: config.baseDatos.url,
      max: config.baseDatos.maxConexiones,
      connectionTimeoutMillis: 5_000,
      application_name: 'esmeralda-backend',
      types: tiposPg,
    });
    // Si una conexión inactiva se cae (p. ej. reinicio de PostgreSQL) no debe tumbar el proceso
    pool.on('error', (error) => this.logger.error(`Conexión inactiva perdida: ${error.message}`));
    this.db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  }

  /**
   * Ejecuta `trabajo` en una transacción. Primero fija app.usuario_id (equivale a
   * `SET LOCAL app.usuario_id = '<id>'`) para que la auditoría registre quién hizo cada cambio;
   * el valor desaparece al terminar la transacción, así no pasa a la siguiente operación que
   * reciba la misma conexión. Si `trabajo` lanza un error, todo se revierte y el error se propaga.
   *
   * @param usuarioId usuario autenticado, o null en operaciones sin usuario (p. ej. el login).
   */
  async transaccion<T>(usuarioId: number | null, trabajo: (trx: Trx) => Promise<T>): Promise<T> {
    if (usuarioId !== null && !(Number.isSafeInteger(usuarioId) && usuarioId > 0)) {
      throw new Error(`usuarioId inválido para la transacción: ${usuarioId}`);
    }
    return this.db.transaction().execute(async (trx) => {
      if (usuarioId !== null) {
        await sql`select set_config('app.usuario_id', ${String(usuarioId)}, true)`.execute(trx);
      }
      return trabajo(trx);
    });
  }

  /** true si PostgreSQL responde. */
  async verificarConexion(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
