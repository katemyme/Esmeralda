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
  esquemaPromocion,
  esquemaSubtotal,
  type DatosPromocion,
  type DatosSubtotal,
} from './esquemas';
import {
  PromocionesService,
  type PromocionAdmin,
  type PromocionDisponible,
} from './promociones.service';

/** /api/promociones — las rebajas que el admin crea y activa, y las que el POS puede aplicar hoy. */
@Controller('promociones')
export class PromocionesController {
  constructor(private readonly promociones: PromocionesService) {}

  @Get()
  @RequierePermiso('PROMOCIONES_GESTIONAR')
  async listar(): Promise<{ promociones: PromocionAdmin[] }> {
    return { promociones: await this.promociones.listar() };
  }

  /** `?subtotal=1200` (opcional): activas y vigentes hoy, con cuánto descontarían. */
  @Get('disponibles')
  @RequierePermiso('VENTAS_PROMOCION')
  async disponibles(
    @Query(new ValidacionZod(esquemaSubtotal)) consulta: DatosSubtotal,
  ): Promise<{ promociones: PromocionDisponible[] }> {
    return { promociones: await this.promociones.disponibles(consulta.subtotal) };
  }

  /** La promoción nace inactiva: se activa con PUT /api/promociones/:id/activa. */
  @Post()
  @RequierePermiso('PROMOCIONES_GESTIONAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaPromocion)) datos: DatosPromocion,
  ): Promise<{ promocion: PromocionAdmin }> {
    return { promocion: await this.promociones.guardar(admin.id, null, datos) };
  }

  @Put(':id')
  @RequierePermiso('PROMOCIONES_GESTIONAR')
  async actualizar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaPromocion)) datos: DatosPromocion,
  ): Promise<{ promocion: PromocionAdmin }> {
    return { promocion: await this.promociones.guardar(admin.id, id, datos) };
  }

  @Put(':id/activa')
  @RequierePermiso('PROMOCIONES_GESTIONAR')
  async cambiarActiva(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaActiva)) datos: DatosActiva,
  ): Promise<{ promocion: PromocionAdmin }> {
    return { promocion: await this.promociones.cambiarActiva(admin.id, id, datos.activa) };
  }
}
