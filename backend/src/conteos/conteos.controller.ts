import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { idEntero } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  ConteosService,
  type Conteo,
  type ConteoDetalle,
  type DiferenciaConteo,
} from './conteos.service';
import {
  esquemaFiltroConteos,
  esquemaIniciarConteo,
  esquemaRegistrarConteo,
  type DatosIniciarConteo,
  type DatosRegistrarConteo,
  type FiltroConteos,
} from './esquemas';

/**
 * /api/conteos — conteo físico con la tablet: la sucursal escanea a ciegas (INVENTARIO_CONTAR) y
 * el admin revisa las diferencias y las aplica como ajustes (INVENTARIO_AJUSTAR).
 */
@Controller('conteos')
export class ConteosController {
  constructor(private readonly conteos: ConteosService) {}

  /** `?estado=&sucursal_id=&limite=&antes_de=` — los de las sucursales del usuario. */
  @Get()
  @RequierePermiso('INVENTARIO_CONTAR', 'INVENTARIO_AJUSTAR')
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroConteos)) filtro: FiltroConteos,
  ): Promise<{ conteos: Conteo[] }> {
    return { conteos: await this.conteos.listar(usuario.id, filtro) };
  }

  /** El conteo con lo escaneado hasta ahora (sin el stock del sistema). */
  @Get(':id')
  @RequierePermiso('INVENTARIO_CONTAR', 'INVENTARIO_AJUSTAR')
  async ver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ conteo: ConteoDetalle }> {
    return { conteo: await this.conteos.buscar(usuario.id, id) };
  }

  /** Lo contado contra el sistema: solo para quien aprueba los ajustes. */
  @Get(':id/diferencias')
  @RequierePermiso('INVENTARIO_AJUSTAR')
  async diferencias(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ diferencias: DiferenciaConteo[] }> {
    return { diferencias: await this.conteos.diferencias(usuario.id, id) };
  }

  /** Solo puede haber un conteo en curso por ubicación. */
  @Post()
  @RequierePermiso('INVENTARIO_CONTAR')
  @HttpCode(HttpStatus.CREATED)
  async iniciar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaIniciarConteo)) datos: DatosIniciarConteo,
  ): Promise<{ conteo: ConteoDetalle }> {
    return { conteo: await this.conteos.iniciar(usuario.id, datos) };
  }

  /** `{ variante_id, cantidad, sumar }`: cada escaneo suma 1; devuelve cuántas van de esa pieza. */
  @Post(':id/registrar')
  @RequierePermiso('INVENTARIO_CONTAR')
  @HttpCode(HttpStatus.OK)
  registrar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaRegistrarConteo)) datos: DatosRegistrarConteo,
  ): Promise<{ variante_id: number; cantidad_contada: number }> {
    return this.conteos.registrar(usuario.id, id, datos);
  }

  /** Termina el escaneo y lo manda a revisión del admin. */
  @Post(':id/enviar')
  @RequierePermiso('INVENTARIO_CONTAR')
  @HttpCode(HttpStatus.OK)
  async enviar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ conteo: ConteoDetalle }> {
    return { conteo: await this.conteos.enviar(usuario.id, id) };
  }

  /** Convierte cada diferencia en un ajuste de inventario. */
  @Post(':id/aplicar')
  @RequierePermiso('INVENTARIO_AJUSTAR')
  @HttpCode(HttpStatus.OK)
  aplicar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ conteo: ConteoDetalle; ajustes: number }> {
    return this.conteos.aplicar(usuario.id, id);
  }

  @Post(':id/cancelar')
  @RequierePermiso('INVENTARIO_CONTAR')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ conteo: ConteoDetalle }> {
    return { conteo: await this.conteos.cancelar(usuario.id, id) };
  }
}
