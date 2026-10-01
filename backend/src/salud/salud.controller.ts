import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { BaseDatosService } from '../base-datos/base-datos.service';

/** GET /api/salud — para monitoreo: confirma que la API y PostgreSQL responden. */
@Controller('salud')
export class SaludController {
  constructor(private readonly bd: BaseDatosService) {}

  @Get()
  async estado(): Promise<{ estado: 'ok'; baseDatos: 'ok' }> {
    if (!(await this.bd.verificarConexion())) {
      throw new HttpException(
        {
          codigo: 'BD_NO_DISPONIBLE',
          mensaje: 'La API funciona, pero no hay conexión con la base de datos',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { estado: 'ok', baseDatos: 'ok' };
  }
}
