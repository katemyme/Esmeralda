import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'kysely';
import { BaseDatosService } from '../base-datos/base-datos.service';
import { CONFIGURACION, type Configuracion } from '../configuracion/configuracion';

export interface ResultadoTareas {
  /** Alertas nuevas por cajas que siguen abiertas después de la hora de cierre. */
  cajas_sin_cerrar: number;
  /** Filas de la foto del inventario del mes que acaba de cerrar (0 si ya estaba tomada). */
  foto_inventario: number;
}

const CADA_15_MINUTOS = 15 * 60 * 1000;

/**
 * Tareas que el servidor corre solo: al arrancar y después cada 15 minutos. Qué hace cada una lo
 * decide la base, y las dos se pueden llamar las veces que sea sin repetir nada:
 * - fn_alertar_cajas_sin_cerrar: una alerta por cada caja que sigue abierta después de la hora del
 *   parámetro CAJA_HORA_ALERTA_CIERRE (o desde un día anterior).
 * - fn_foto_inventario_mensual: la primera vez que corre en un mes nuevo guarda la foto del
 *   inventario valorizado del mes que acaba de cerrar.
 * Se apagan con TAREAS_PROGRAMADAS=false.
 */
@Injectable()
export class TareasService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TareasService.name);
  private temporizador: NodeJS.Timeout | undefined;
  private enCurso = false;

  constructor(
    private readonly bd: BaseDatosService,
    @Inject(CONFIGURACION) private readonly config: Configuracion,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.tareasProgramadas) return;
    this.temporizador = setInterval(() => void this.pasada(), CADA_15_MINUTOS);
    this.temporizador.unref(); // el temporizador solo no mantiene vivo el proceso
    void this.pasada();
  }

  onApplicationShutdown(): void {
    clearInterval(this.temporizador);
  }

  /** Corre las tareas una vez. `ahora` existe para las pruebas. */
  async ejecutar(ahora: Date = new Date()): Promise<ResultadoTareas> {
    const { rows } = await sql<ResultadoTareas>`
      select fn_alertar_cajas_sin_cerrar(${ahora}::timestamptz) as cajas_sin_cerrar,
             fn_foto_inventario_mensual(${ahora}::timestamptz) as foto_inventario`.execute(
      this.bd.db,
    );
    return rows[0];
  }

  /**
   * Una pasada programada. Si falla (p. ej. la base no responde) se anota y no pasa nada más: se
   * vuelve a intentar en la siguiente. Nunca corren dos a la vez.
   */
  private async pasada(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      const resultado = await this.ejecutar();
      if (resultado.cajas_sin_cerrar > 0) {
        this.logger.log(`Cajas sin cerrar: ${resultado.cajas_sin_cerrar} alerta(s) nueva(s)`);
      }
      if (resultado.foto_inventario > 0) {
        this.logger.log('Se guardó la foto mensual del inventario valorizado');
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      this.logger.error(`Las tareas programadas fallaron: ${mensaje}`);
    } finally {
      this.enCurso = false;
    }
  }
}
