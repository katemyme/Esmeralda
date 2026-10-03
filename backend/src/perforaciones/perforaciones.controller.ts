import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaActiva, idEntero, type DatosActiva } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  consultaPiezasPaquete,
  esquemaActualizarPerforacion,
  esquemaCrearPerforacion,
  esquemaPiezaPermitida,
  esquemaPrecioEspecial,
  esquemaPrecioGama,
  esquemaPrecioServicio,
  type DatosActualizarPerforacion,
  type DatosCrearPerforacion,
  type DatosPiezaPermitida,
  type DatosPiezasPaquete,
  type DatosPrecioEspecial,
  type DatosPrecioGama,
  type DatosPrecioServicio,
} from './esquemas';
import {
  PerforacionesService,
  type PerforacionCatalogo,
  type PrecioPaquete,
} from './perforaciones.service';

/**
 * /api/perforaciones — tipos de perforación y precio de sus paquetes: solo servicio, tabla
 * perforación × gama, precios especiales y piezas permitidas.
 */
@Controller('perforaciones')
export class PerforacionesController {
  constructor(private readonly perforaciones: PerforacionesService) {}

  @Get()
  @RequierePermiso('PRODUCTOS_VER')
  async listar(): Promise<{ perforaciones: PerforacionCatalogo[] }> {
    return { perforaciones: await this.perforaciones.listar() };
  }

  @Get(':id')
  @RequierePermiso('PRODUCTOS_VER')
  async ver(@Param('id', idEntero()) id: number): Promise<{ perforacion: PerforacionCatalogo }> {
    return { perforacion: await this.perforaciones.buscar(id) };
  }

  /** `?piezas=12,15` → cuánto cuesta el paquete con esas piezas y qué regla se aplicó. */
  @Get(':id/precio-paquete')
  @RequierePermiso('PRODUCTOS_VER')
  precioPaquete(
    @Param('id', idEntero()) id: number,
    @Query(consultaPiezasPaquete()) consulta: DatosPiezasPaquete,
  ): Promise<PrecioPaquete> {
    return this.perforaciones.precioPaquete(id, consulta.piezas);
  }

  /** Fija el precio de solo servicio, por eso la base pide además PRECIOS_EDITAR. */
  @Post()
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCrearPerforacion)) datos: DatosCrearPerforacion,
  ): Promise<{ perforacion: PerforacionCatalogo }> {
    return { perforacion: await this.perforaciones.crear(admin.id, datos) };
  }

  @Put(':id')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActualizarPerforacion)) datos: DatosActualizarPerforacion,
  ): Promise<{ perforacion: PerforacionCatalogo }> {
    return { perforacion: await this.perforaciones.actualizar(admin.id, id, datos) };
  }

  /** Desactivada no aparece en el POS ni se puede vender (ni sola ni en paquete). */
  @Put(':id/activa')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async cambiarActiva(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActiva)) datos: DatosActiva,
  ): Promise<{ perforacion: PerforacionCatalogo }> {
    return { perforacion: await this.perforaciones.cambiarActiva(admin.id, id, datos.activa) };
  }

  @Put(':id/precio-servicio')
  @RequierePermiso('PRECIOS_EDITAR')
  async cambiarPrecioServicio(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaPrecioServicio)) datos: DatosPrecioServicio,
  ): Promise<{ perforacion: PerforacionCatalogo }> {
    return {
      perforacion: await this.perforaciones.cambiarPrecioServicio(admin.id, id, datos.precio),
    };
  }

  /** `{ gama_id, precio }`: precio del paquete con esa gama (null lo quita de la tabla). */
  @Put(':id/precios-gama')
  @RequierePermiso('PRECIOS_EDITAR')
  async cambiarPrecioGama(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaPrecioGama)) datos: DatosPrecioGama,
  ): Promise<{ perforacion: PerforacionCatalogo }> {
    return { perforacion: await this.perforaciones.cambiarPrecioGama(admin.id, id, datos) };
  }

  /** `{ variante_id | gama_id, precio, motivo }`: precio especial (null lo quita). */
  @Put(':id/precios-especiales')
  @RequierePermiso('PRECIOS_EDITAR')
  async cambiarPrecioEspecial(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaPrecioEspecial)) datos: DatosPrecioEspecial,
  ): Promise<{ perforacion: PerforacionCatalogo }> {
    return { perforacion: await this.perforaciones.cambiarPrecioEspecial(admin.id, id, datos) };
  }

  /** `{ gama_id | categoria_id | variante_id, permitir }`: agrega o quita una regla. */
  @Put(':id/piezas-permitidas')
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  async cambiarPiezaPermitida(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaPiezaPermitida)) datos: DatosPiezaPermitida,
  ): Promise<{ perforacion: PerforacionCatalogo }> {
    return { perforacion: await this.perforaciones.cambiarPiezaPermitida(admin.id, id, datos) };
  }
}
