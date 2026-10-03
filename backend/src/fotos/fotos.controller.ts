import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Publica } from '../autenticacion/decoradores';
import { RequierePermiso } from '../autenticacion/permisos';
import { NoEncontrado } from '../comun/no-encontrado';
import { FOTO_MAX_BYTES, FotosService, type ArchivoSubido } from './fotos.service';

/** Recibe una imagen en el campo "foto" de un formulario multipart (hasta 5 MB, en memoria). */
export const SubirFoto = () =>
  UseInterceptors(FileInterceptor('foto', { limits: { fileSize: FOTO_MAX_BYTES, files: 1 } }));

/** /api/fotos — fotos de productos y de mermas. */
@Controller('fotos')
export class FotosController {
  constructor(private readonly fotos: FotosService) {}

  /**
   * Sube una imagen (JPG, PNG o WebP) y devuelve su dirección, para usarla como `foto_url`
   * (p. ej. al reportar una merma). La foto de una variante tiene su propia ruta:
   * POST /api/variantes/:id/foto.
   */
  @Post()
  @RequierePermiso('PRODUCTOS_GESTIONAR', 'INVENTARIO_REPORTAR_MERMA')
  @SubirFoto()
  @HttpCode(HttpStatus.CREATED)
  async subir(@UploadedFile() archivo: ArchivoSubido | undefined): Promise<{ foto_url: string }> {
    return { foto_url: await this.fotos.guardar(archivo) };
  }

  /**
   * Sirve la imagen. Es pública porque una etiqueta <img> no puede enviar el token de acceso;
   * el nombre del archivo es aleatorio y solo se conoce a través de la API.
   */
  @Get(':archivo')
  @Publica()
  ver(@Param('archivo') nombre: string, @Res() respuesta: Response): void {
    const archivo = this.fotos.ubicar(nombre);
    if (!archivo) throw new NoEncontrado('La foto no existe');
    respuesta.sendFile(
      archivo.ruta,
      {
        headers: {
          'Content-Type': archivo.tipo,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      },
      (error) => {
        if (error && !respuesta.headersSent) {
          respuesta.status(HttpStatus.NOT_FOUND).json({
            codigo: 'NO_ENCONTRADO',
            mensaje: 'La foto no existe',
          });
        }
      },
    );
  }
}
