import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { UsuarioActual } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import type { UsuarioAutenticado } from '../autenticacion/usuario-autenticado';
import { ValidacionZod } from '../comun/validacion-zod.pipe';
import { CargaInicialService, type ResultadoCarga } from './carga-inicial.service';

const PLANTILLA_MAX_BYTES = 10 * 1024 * 1024;

const esquemaOpciones = z.object({
  /** Sin `aplicar=true` la carga solo se simula: se revisa todo y no se guarda nada. */
  aplicar: z
    .enum(['true', 'false'], { error: 'aplicar debe ser true o false' })
    .transform((valor) => valor === 'true')
    .default(false),
});
type Opciones = z.output<typeof esquemaOpciones>;

/**
 * /api/carga-inicial — carga el sistema desde la plantilla de Excel (docs/plantilla-carga-inicial.xlsx):
 * categorías, perforaciones y sus precios, productos, inventario inicial, proveedores, usuarios y
 * promociones.
 */
@Controller('carga-inicial')
export class CargaInicialController {
  constructor(private readonly carga: CargaInicialService) {}

  /**
   * Recibe la plantilla en el campo "archivo". Por defecto es una simulación: devuelve qué se
   * crearía y los errores de cada fila, sin guardar nada. Con `?aplicar=true` se guarda todo, o
   * nada si hay algún error (422 con el mismo informe).
   */
  @Post()
  @RequierePermiso('PRODUCTOS_GESTIONAR')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: PLANTILLA_MAX_BYTES, files: 1 } }),
  )
  @HttpCode(HttpStatus.OK)
  async cargar(
    @UsuarioActual() admin: UsuarioAutenticado,
    @Query(new ValidacionZod(esquemaOpciones)) opciones: Opciones,
    @UploadedFile() archivo: { buffer: Buffer } | undefined,
  ): Promise<ResultadoCarga> {
    if (!archivo?.buffer?.length) {
      throw new HttpException(
        {
          codigo: 'ARCHIVO_INVALIDO',
          mensaje: 'Adjunte la plantilla de Excel en el campo "archivo"',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const resultado = await this.carga.cargar(admin.id, archivo.buffer, opciones.aplicar);
    if (opciones.aplicar && !resultado.aplicada) {
      const n = resultado.errores.length;
      throw new HttpException(
        {
          codigo: 'CARGA_CON_ERRORES',
          mensaje: `La plantilla tiene ${n} ${n === 1 ? 'error' : 'errores'}: no se guardó nada. Corríjala y vuelva a cargarla.`,
          ...resultado,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return resultado;
  }
}
