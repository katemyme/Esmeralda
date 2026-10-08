import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { esquemaMotivo, idEntero, type DatosMotivo } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  DevolucionesService,
  type DevolucionDetalle,
  type DevolucionResumen,
  type VentaParaDevolver,
} from './devoluciones.service';
import {
  esquemaBuscarVenta,
  esquemaEjecutarDevolucion,
  esquemaFiltroDevoluciones,
  esquemaResolverDevolucion,
  esquemaSolicitarDevolucion,
  esquemaTransferencia,
  type DatosBuscarVenta,
  type DatosEjecutarDevolucion,
  type DatosResolverDevolucion,
  type DatosSolicitarDevolucion,
  type DatosTransferencia,
  type FiltroDevoluciones,
} from './esquemas';

/**
 * /api/devoluciones — devoluciones y cambios de ventas de turnos ya cerrados (con el turno abierto
 * la venta se anula). Tres pasos: la sucursal la solicita, el administrador la aprueba o la
 * rechaza, y ya aprobada se ejecuta en la caja abierta de la sucursal donde está el cliente.
 */
@Controller('devoluciones')
export class DevolucionesController {
  constructor(private readonly devoluciones: DevolucionesService) {}

  /**
   * `?numero=LAM-00000012` (el QR del ticket): la factura, de la sucursal que sea, con lo que se
   * puede devolver de cada línea y las solicitudes que ya tiene.
   */
  @Get('venta')
  @RequierePermiso('DEVOLUCIONES_REGISTRAR', 'DEVOLUCIONES_APROBAR')
  async buscarVenta(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaBuscarVenta)) filtro: DatosBuscarVenta,
  ): Promise<{ venta: VentaParaDevolver }> {
    return { venta: await this.devoluciones.buscarVenta(usuario, filtro.numero) };
  }

  /**
   * `?estado=&tipo=&sucursal_id=&desde=&hasta=&por_transferir=&buscar=&limite=&antes_de=` — el
   * administrador ve todas; los demás, las de sus sucursales.
   */
  @Get()
  @RequierePermiso('DEVOLUCIONES_REGISTRAR', 'DEVOLUCIONES_APROBAR')
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaFiltroDevoluciones)) filtro: FiltroDevoluciones,
  ): Promise<{ devoluciones: DevolucionResumen[] }> {
    return { devoluciones: await this.devoluciones.listar(usuario.id, filtro) };
  }

  /** La devolución completa, con lo que va en su ticket. */
  @Get(':id')
  @RequierePermiso('DEVOLUCIONES_REGISTRAR', 'DEVOLUCIONES_APROBAR')
  async ver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ devolucion: DevolucionDetalle }> {
    return { devolucion: await this.devoluciones.buscar(usuario.id, id) };
  }

  /**
   * `{ venta_id, tipo, motivo, cliente_nombre, cliente_telefono, lineas: [{ detalle_id, cantidad,
   * estado }] }`: queda pendiente, aparta lo pedido y deja una alerta al administrador.
   */
  @Post()
  @RequierePermiso('DEVOLUCIONES_REGISTRAR')
  @HttpCode(HttpStatus.CREATED)
  async solicitar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body(new ValidacionZod(esquemaSolicitarDevolucion)) datos: DatosSolicitarDevolucion,
  ): Promise<{ devolucion: DevolucionDetalle }> {
    return { devolucion: await this.devoluciones.solicitar(usuario, datos) };
  }

  /** `{ aprobar, comentario }`: solo el administrador. Para rechazar, el comentario es obligatorio. */
  @Post(':id/resolver')
  @RequierePermiso('DEVOLUCIONES_APROBAR')
  @HttpCode(HttpStatus.OK)
  async resolver(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaResolverDevolucion)) datos: DatosResolverDevolucion,
  ): Promise<{ devolucion: DevolucionDetalle }> {
    return { devolucion: await this.devoluciones.resolver(usuario.id, id, datos) };
  }

  /** `{ motivo }`: mientras no se haya ejecutado; quien la solicitó o el administrador. */
  @Post(':id/cancelar')
  @RequierePermiso('DEVOLUCIONES_REGISTRAR', 'DEVOLUCIONES_APROBAR')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaMotivo)) datos: DatosMotivo,
  ): Promise<{ devolucion: DevolucionDetalle }> {
    return { devolucion: await this.devoluciones.cancelar(usuario.id, id, datos.motivo) };
  }

  /**
   * Ejecuta una aprobada en el turno abierto de la caja de la sesión. Devolución: `{}`. Cambio:
   * `{ clave_idempotencia, items, pagos, notas }`, como una venta (sin promoción); si esa clave ya
   * se usó en este mismo cambio responde lo mismo con `repetida: true`.
   */
  @Post(':id/ejecutar')
  @RequierePermiso('DEVOLUCIONES_REGISTRAR')
  @HttpCode(HttpStatus.OK)
  async ejecutar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaEjecutarDevolucion)) datos: DatosEjecutarDevolucion,
  ): Promise<{ devolucion: DevolucionDetalle; repetida: boolean }> {
    return this.devoluciones.ejecutar(usuario, id, datos);
  }

  /** `{ referencia }`: el administrador anota la transferencia de lo que no salió de la caja. */
  @Post(':id/transferencia')
  @RequierePermiso('DEVOLUCIONES_APROBAR')
  @HttpCode(HttpStatus.OK)
  async registrarTransferencia(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Body(new ValidacionZod(esquemaTransferencia)) datos: DatosTransferencia,
  ): Promise<{ devolucion: DevolucionDetalle }> {
    return {
      devolucion: await this.devoluciones.registrarTransferencia(usuario.id, id, datos.referencia),
    };
  }

  /**
   * El ticket de la devolución en PDF para la impresora de 80 mm. La primera vez es el original;
   * las siguientes salen con la palabra COPIA (`X-Ticket-Impresion` dice cuál es: 1, 2, 3…).
   */
  @Post(':id/imprimir')
  @RequierePermiso('DEVOLUCIONES_REGISTRAR', 'DEVOLUCIONES_APROBAR')
  @HttpCode(HttpStatus.OK)
  async imprimir(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const { pdf, numero, impresion } = await this.devoluciones.imprimir(usuario.id, id);
    respuesta.setHeader('X-Ticket-Impresion', String(impresion));
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="devolucion-${numero}.pdf"`,
      length: pdf.length,
    });
  }
}
