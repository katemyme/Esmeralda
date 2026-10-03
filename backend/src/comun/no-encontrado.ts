import { HttpException, HttpStatus } from '@nestjs/common';

/** 404 con el formato de la API: `throw new NoEncontrado('El usuario 9 no existe')`. */
export class NoEncontrado extends HttpException {
  constructor(mensaje: string) {
    super({ codigo: 'NO_ENCONTRADO', mensaje }, HttpStatus.NOT_FOUND);
  }
}
