import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { idEntero } from '../comun/esquemas';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import {
  esquemaBuscarPiezas,
  esquemaPdfEtiquetas,
  type BuscarPiezas,
  type DatosPdfEtiquetas,
} from './esquemas';
import {
  EtiquetasService,
  type CompraParaEtiquetas,
  type PiezaEtiqueta,
} from './etiquetas.service';

/**
 * /api/etiquetas — las etiquetas con QR de las piezas, solo para quien administra el catálogo (el
 * administrador, en la bodega). Se eligen piezas sueltas, todo lo de la bodega o lo de una compra,
 * y se piden en PDF: hoja carta con cuadrícula (adhesivas) o una por página (impresora de etiquetas).
 */
@Controller('etiquetas')
@RequierePermiso('PRODUCTOS_GESTIONAR')
export class EtiquetasController {
  constructor(private readonly etiquetas: EtiquetasService) {}

  /** `?texto=`: por nombre, código o código de barras, con lo que hay en la bodega. */
  @Get('piezas')
  async buscar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaBuscarPiezas)) consulta: BuscarPiezas,
  ): Promise<{ piezas: PiezaEtiqueta[] }> {
    return { piezas: await this.etiquetas.buscar(usuario.id, consulta.texto) };
  }

  /** Todo lo que hay en la bodega: las copias que se proponen son las existencias. */
  @Get('bodega')
  async bodega(@UsuarioActual() usuario: UsuarioAutenticado): Promise<{ piezas: PiezaEtiqueta[] }> {
    return { piezas: await this.etiquetas.bodega(usuario.id) };
  }

  /** Las compras recientes (pide también INVENTARIO_ENTRADA). */
  @Get('compras')
  async compras(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ compras: CompraParaEtiquetas[] }> {
    return { compras: await this.etiquetas.compras(usuario.id) };
  }

  /** Lo que entró con la compra: las copias que se proponen son lo recibido. */
  @Get('compras/:id')
  compra(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', idEntero()) id: number,
  ): Promise<{ compra: CompraParaEtiquetas; piezas: PiezaEtiqueta[] }> {
    return this.etiquetas.compra(usuario.id, id);
  }

  /**
   * `{ formato: 'HOJA' | 'ROLLO', piezas: [{ variante_id, copias }], hoja?, rollo? }` → el PDF de las
   * etiquetas. No se anota nada: se pueden imprimir las veces que haga falta.
   */
  @Post('pdf')
  @HttpCode(HttpStatus.OK)
  async pdf(
    @Body(new ValidacionZod(esquemaPdfEtiquetas)) datos: DatosPdfEtiquetas,
  ): Promise<StreamableFile> {
    const pdf = await this.etiquetas.pdf(datos);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'inline; filename="etiquetas.pdf"',
      length: pdf.length,
    });
  }
}
