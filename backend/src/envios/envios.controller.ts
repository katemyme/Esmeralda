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
import { esquemaMotivo, idEntero, type DatosMotivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  EnviosService,
  type EnvioDetalle,
  type EnvioResumen,
  type SugerenciaReparto,
} from './envios.service';
import {
  esquemaCrearEnvio,
  esquemaFiltroEnvios,
  esquemaLineaEnvio,
  esquemaRecibirEnvio,
  esquemaSugerencia,
  type DatosCrearEnvio,
  type DatosLineaEnvio,
  type DatosRecibirEnvio,
  type DatosSugerencia,
  type FiltroEnvios,
} from './esquemas';

/**
 * /api/envios — mercadería entre la bodega y las sucursales, en dos pasos: quien envía la saca
 * del origen (INVENTARIO_TRASLADAR) y quien recibe escanea lo que llegó (INVENTARIO_RECIBIR).
 */
@Controller('envios')
export class EnviosController {
  constructor(private readonly envios: EnviosService) {}

  /** `?estado=&origen_id=&destino_id=&limite=&antes_de=` — los envíos de las sucursales del usuario. */
  @Get()
  @RequierePermiso('INVENTARIO_TRASLADAR', 'INVENTARIO_RECIBIR')
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroEnvios)) filtro: FiltroEnvios,
  ): Promise<{ envios: EnvioResumen[] }> {
    return { envios: await this.envios.listar(usuario.id, filtro) };
  }

  /** `?variante_id=&cantidad=` → cuánto mandar a cada sucursal. */
  @Get('sugerencia')
  @RequierePermiso('INVENTARIO_TRASLADAR')
  async sugerencia(
    @Query(new ValidacionZod(esquemaSugerencia)) consulta: DatosSugerencia,
  ): Promise<{ sugerencia: SugerenciaReparto[] }> {
    return {
      sugerencia: await this.envios.sugerirReparto(consulta.variante_id, consulta.cantidad),
    };
  }

  @Get(':id')
  @RequierePermiso('INVENTARIO_TRASLADAR', 'INVENTARIO_RECIBIR')
  async ver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ envio: EnvioDetalle }> {
    return { envio: await this.envios.buscar(usuario.id, id) };
  }

  @Post()
  @RequierePermiso('INVENTARIO_TRASLADAR')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaCrearEnvio)) datos: DatosCrearEnvio,
  ): Promise<{ envio: EnvioDetalle }> {
    return { envio: await this.envios.crear(usuario.id, datos) };
  }

  /** `{ variante_id, cantidad }`: agrega la pieza, cambia su cantidad o (con 0) la quita. */
  @Put(':id/lineas')
  @RequierePermiso('INVENTARIO_TRASLADAR')
  async ponerLinea(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaLineaEnvio)) linea: DatosLineaEnvio,
  ): Promise<{ envio: EnvioDetalle }> {
    return { envio: await this.envios.ponerLinea(usuario.id, id, linea) };
  }

  @Post(':id/enviar')
  @RequierePermiso('INVENTARIO_TRASLADAR')
  @HttpCode(HttpStatus.OK)
  async enviar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ envio: EnvioDetalle }> {
    return { envio: await this.envios.enviar(usuario.id, id) };
  }

  /** `{ recibido: [{ variante_id, cantidad }] }`: lo que la sucursal escaneó. */
  @Post(':id/recibir')
  @RequierePermiso('INVENTARIO_RECIBIR')
  @HttpCode(HttpStatus.OK)
  async recibir(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaRecibirEnvio)) datos: DatosRecibirEnvio,
  ): Promise<{ envio: EnvioDetalle }> {
    return { envio: await this.envios.recibir(usuario.id, id, datos) };
  }

  /** Solo un borrador se cancela; uno en tránsito debe recibirse. */
  @Post(':id/cancelar')
  @RequierePermiso('INVENTARIO_TRASLADAR')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaMotivo)) datos: DatosMotivo,
  ): Promise<{ envio: EnvioDetalle }> {
    return { envio: await this.envios.cancelar(usuario.id, id, datos.motivo) };
  }
}
