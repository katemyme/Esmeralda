import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseError } from 'pg';
import { traducirError } from './errores';

function errorBd(
  codigo: string,
  mensaje: string,
  extra: Partial<DatabaseError> = {},
): DatabaseError {
  return Object.assign(new DatabaseError(mensaje, 0, 'error'), { code: codigo }, extra);
}

describe('traducirError: errores de PostgreSQL', () => {
  it('permiso denegado (fn_exigir_permiso) → 403 con el mensaje de la base', () => {
    expect(traducirError(errorBd('42501', 'Permiso denegado: se requiere VENTAS_ANULAR'))).toEqual({
      estado: 403,
      cuerpo: {
        codigo: 'PERMISO_DENEGADO',
        mensaje: 'Permiso denegado: se requiere VENTAS_ANULAR',
      },
    });
  });

  it('regla de negocio (RAISE EXCEPTION) → 422 con el mensaje de la base', () => {
    expect(traducirError(errorBd('P0001', 'Pago insuficiente: total C$ 250.00'))).toEqual({
      estado: 422,
      cuerpo: { codigo: 'REGLA_NEGOCIO', mensaje: 'Pago insuficiente: total C$ 250.00' },
    });
  });

  it('la función pide una confirmación explícita (ESM02) → 409 con el mensaje de la base', () => {
    const mensaje =
      'El tipo de cambio 366.0000 se aleja más de 5 % del último registrado (36.6243). Si es correcto, confírmelo.';
    expect(traducirError(errorBd('ESM02', mensaje))).toEqual({
      estado: 409,
      cuerpo: { codigo: 'CONFIRMACION_REQUERIDA', mensaje },
    });
  });

  it('CHECK propio de una función (sin restricción) → 422 con su mensaje', () => {
    const error = errorBd('23514', 'El parámetro X debe ser un número positivo');
    expect(traducirError(error).cuerpo.mensaje).toBe('El parámetro X debe ser un número positivo');
  });

  it('CHECK de una tabla → 422 genérico, sin el texto técnico, con el nombre de la restricción', () => {
    const error = errorBd(
      '23514',
      'new row for relation "venta" violates check constraint "ck_x"',
      {
        constraint: 'ck_x',
      },
    );
    expect(traducirError(error)).toEqual({
      estado: 422,
      cuerpo: {
        codigo: 'REGLA_NEGOCIO',
        mensaje: 'Los datos no cumplen una regla del sistema',
        restriccion: 'ck_x',
      },
    });
  });

  it('tabla de solo inserción → 409 con el mensaje del trigger', () => {
    const error = errorBd('23001', 'La tabla venta_pago es de solo inserción');
    expect(traducirError(error)).toEqual({
      estado: 409,
      cuerpo: {
        codigo: 'OPERACION_NO_PERMITIDA',
        mensaje: 'La tabla venta_pago es de solo inserción',
      },
    });
  });

  it('duplicado → 409 genérico con la restricción', () => {
    const error = errorBd(
      '23505',
      'duplicate key value violates unique constraint "variante_sku_key"',
      {
        constraint: 'variante_sku_key',
      },
    );
    expect(traducirError(error)).toEqual({
      estado: 409,
      cuerpo: {
        codigo: 'DUPLICADO',
        mensaje: 'Ya existe un registro con esos datos',
        restriccion: 'variante_sku_key',
      },
    });
  });

  it('dato faltante → 422 con el nombre de la columna', () => {
    const error = errorBd('23502', 'null value in column "nombre"', { column: 'nombre' });
    expect(traducirError(error)).toEqual({
      estado: 422,
      cuerpo: { codigo: 'DATO_FALTANTE', mensaje: 'Falta el dato obligatorio "nombre"' },
    });
  });

  it('dato con formato inválido (clase 22) → 400', () => {
    expect(traducirError(errorBd('22P02', 'invalid input syntax for type bigint')).estado).toBe(
      400,
    );
  });

  it('bloqueo mutuo o conflicto de serialización → 409 para reintentar', () => {
    expect(traducirError(errorBd('40P01', 'deadlock detected')).cuerpo.codigo).toBe('REINTENTAR');
    expect(traducirError(errorBd('40001', 'could not serialize')).cuerpo.codigo).toBe('REINTENTAR');
  });

  it('contraseña o base incorrecta → 503 sin revelar el detalle', () => {
    const error = errorBd('28P01', 'password authentication failed for user "postgres"');
    expect(traducirError(error)).toEqual({
      estado: 503,
      cuerpo: expect.objectContaining({ codigo: 'BD_NO_DISPONIBLE' }),
    });
    expect(JSON.stringify(traducirError(error))).not.toContain('postgres');
  });

  it('cualquier otro error de la base → 500 genérico', () => {
    const resultado = traducirError(errorBd('42P01', 'relation "tabla_x" does not exist'));
    expect(resultado.estado).toBe(500);
    expect(resultado.cuerpo.mensaje).not.toContain('tabla_x');
  });
});

describe('traducirError: otros errores', () => {
  it('ruta inexistente de Nest → 404 en español', () => {
    expect(traducirError(new NotFoundException('Cannot GET /api/nada'))).toEqual({
      estado: 404,
      cuerpo: { codigo: 'NO_ENCONTRADO', mensaje: 'No existe la ruta GET /api/nada' },
    });
  });

  it('JSON mal formado (body-parser) → 400 en español', () => {
    const error = new BadRequestException("Expected property name or '}' in JSON at position 1");
    expect(traducirError(error).cuerpo).toEqual({
      codigo: 'SOLICITUD_INVALIDA',
      mensaje: 'El cuerpo de la solicitud no es un JSON válido',
    });
  });

  it('error propio con { codigo, mensaje } → se respeta tal cual', () => {
    const error = new HttpException(
      { codigo: 'DEBE_CAMBIAR_PASSWORD', mensaje: 'Cambie su contraseña' },
      403,
    );
    expect(traducirError(error)).toEqual({
      estado: 403,
      cuerpo: { codigo: 'DEBE_CAMBIAR_PASSWORD', mensaje: 'Cambie su contraseña' },
    });
  });

  it('HttpException con texto → código según el estado', () => {
    expect(traducirError(new ForbiddenException('Solo el administrador'))).toEqual({
      estado: 403,
      cuerpo: { codigo: 'PERMISO_DENEGADO', mensaje: 'Solo el administrador' },
    });
  });

  it('PostgreSQL apagado (conexión rechazada) → 503', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    expect(traducirError(error).cuerpo.codigo).toBe('BD_NO_DISPONIBLE');
    expect(traducirError(new Error('timeout exceeded when trying to connect')).estado).toBe(503);
  });

  it('PostgreSQL apagado con "localhost" (AggregateError de ::1 y 127.0.0.1) → 503', () => {
    const error = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
    expect(traducirError(error).cuerpo.codigo).toBe('BD_NO_DISPONIBLE');
  });

  it('error 413 de body-parser → 413 en español', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(traducirError(error)).toEqual({
      estado: 413,
      cuerpo: { codigo: 'SOLICITUD_MUY_GRANDE', mensaje: 'La solicitud es demasiado grande' },
    });
  });

  it('error inesperado → 500 sin exponer el mensaje interno', () => {
    const resultado = traducirError(
      new TypeError("Cannot read properties of undefined (reading 'x')"),
    );
    expect(resultado.estado).toBe(500);
    expect(resultado.cuerpo.codigo).toBe('ERROR_INTERNO');
    expect(resultado.cuerpo.mensaje).not.toContain('undefined');
  });
});
