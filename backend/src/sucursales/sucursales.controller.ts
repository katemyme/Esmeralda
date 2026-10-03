import { Controller, Get } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { SucursalesService, type SucursalConCajas } from './sucursales.service';

/**
 * /api/sucursales — ubicaciones y cajas del usuario, para los formularios del panel (asignar
 * sucursales a un usuario, elegir la caja al registrar un equipo). Solo lectura.
 */
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Get()
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ sucursales: SucursalConCajas[] }> {
    return { sucursales: await this.sucursales.listar(usuario.id) };
  }
}
