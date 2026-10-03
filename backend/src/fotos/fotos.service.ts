import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIGURACION, type Configuracion } from '../configuracion/configuracion';
import { PREFIJO_API } from '../configurar-app';

/** Tamaño máximo de una foto. */
export const FOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Lo que entrega multer por cada archivo subido (solo lo que se usa aquí). */
export interface ArchivoSubido {
  buffer: Buffer;
  size: number;
}

const RUTA_PUBLICA = `/${PREFIJO_API}/fotos/`;
const NOMBRE_VALIDO = /^[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$/;

const TIPOS: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** El formato se decide por el contenido del archivo, no por su nombre ni por lo que diga el navegador. */
function extension(contenido: Buffer): string | null {
  if (contenido.length < 12) return null;
  if (contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff) return 'jpg';
  if (
    contenido.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    contenido.subarray(0, 4).toString('latin1') === 'RIFF' &&
    contenido.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function fotoInvalida(mensaje: string): HttpException {
  return new HttpException({ codigo: 'FOTO_INVALIDA', mensaje }, HttpStatus.BAD_REQUEST);
}

/**
 * Fotos de productos y de mermas. Se guardan en una carpeta del servidor (DIR_FOTOS) con un
 * nombre al azar y se sirven en /api/fotos/<archivo>; la base solo guarda esa dirección.
 */
@Injectable()
export class FotosService {
  private readonly logger = new Logger(FotosService.name);
  private readonly directorio: string;

  constructor(@Inject(CONFIGURACION) config: Configuracion) {
    this.directorio = config.dirFotos;
  }

  /** Guarda la imagen y devuelve su dirección pública (lo que va en foto_url). */
  async guardar(archivo: ArchivoSubido | undefined): Promise<string> {
    if (!archivo?.buffer?.length) {
      throw fotoInvalida('Adjunte la imagen en el campo "foto"');
    }
    const ext = extension(archivo.buffer);
    if (!ext) throw fotoInvalida('La foto debe ser una imagen JPG, PNG o WebP');

    const nombre = `${randomBytes(18).toString('base64url')}.${ext}`;
    await mkdir(this.directorio, { recursive: true });
    await writeFile(join(this.directorio, nombre), archivo.buffer, { flag: 'wx' });
    return `${RUTA_PUBLICA}${nombre}`;
  }

  /** Ruta en disco y tipo de un archivo de /api/fotos/:archivo (null si el nombre no es de una foto). */
  ubicar(nombre: string): { ruta: string; tipo: string } | null {
    if (!NOMBRE_VALIDO.test(nombre)) return null; // también descarta "../" y similares
    return { ruta: join(this.directorio, nombre), tipo: TIPOS[nombre.split('.').pop() ?? ''] };
  }

  /** Borra el archivo de una foto subida aquí (una dirección externa o vacía se ignora). */
  async borrar(fotoUrl: string | null | undefined): Promise<void> {
    if (!fotoUrl?.startsWith(RUTA_PUBLICA)) return;
    const archivo = this.ubicar(fotoUrl.slice(RUTA_PUBLICA.length));
    if (!archivo) return;
    try {
      await unlink(archivo.ruta);
    } catch (error) {
      // que falte el archivo no debe impedir cambiar la foto
      if ((error as { code?: string }).code !== 'ENOENT') {
        this.logger.warn(`No se pudo borrar ${archivo.ruta}: ${(error as Error).message}`);
      }
    }
  }
}

/** true si la dirección es de una foto subida al servidor (/api/fotos/...). */
export function esFotoSubida(direccion: string): boolean {
  return (
    direccion.startsWith(RUTA_PUBLICA) && NOMBRE_VALIDO.test(direccion.slice(RUTA_PUBLICA.length))
  );
}
