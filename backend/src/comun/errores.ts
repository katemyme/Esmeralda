import { HttpException } from '@nestjs/common';
import { DatabaseError } from 'pg';

/** Cuerpo de toda respuesta de error de la API. */
export interface RespuestaError {
  /** Identificador estable para el frontend, p. ej. PERMISO_DENEGADO. */
  codigo: string;
  /** Texto en español para mostrar al usuario. */
  mensaje: string;
  /** Restricción de la base que se violó (si aplica), para que el frontend afine el mensaje. */
  restriccion?: string;
  /** Datos inválidos: un mensaje por campo (DATOS_INVALIDOS). */
  errores?: { campo: string; mensaje: string }[];
}

export interface ErrorTraducido {
  estado: number;
  cuerpo: RespuestaError;
}

const CODIGO_POR_ESTADO: Record<number, string> = {
  400: 'SOLICITUD_INVALIDA',
  401: 'NO_AUTENTICADO',
  403: 'PERMISO_DENEGADO',
  404: 'NO_ENCONTRADO',
  409: 'CONFLICTO',
  413: 'SOLICITUD_MUY_GRANDE',
  422: 'REGLA_NEGOCIO',
  429: 'DEMASIADOS_INTENTOS',
};

const ERROR_INTERNO: ErrorTraducido = {
  estado: 500,
  cuerpo: {
    codigo: 'ERROR_INTERNO',
    mensaje: 'Ocurrió un error inesperado. Intente de nuevo; si continúa, avise al administrador.',
  },
};

const SIN_BASE_DATOS: ErrorTraducido = {
  estado: 503,
  cuerpo: {
    codigo: 'BD_NO_DISPONIBLE',
    mensaje: 'No hay conexión con la base de datos. Intente de nuevo en unos minutos.',
  },
};

// Mensajes en inglés de multer/busboy cuando el formulario multipart no viene como se espera
const FORMULARIO_MAL_ARMADO =
  /^(Unexpected (file )?field|Too many (files|parts|fields)|Field (name|value) (missing|too long)|Multipart: |Unexpected end of form|Malformed part header)/;

const CODIGOS_RED = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

function respuesta(
  estado: number,
  codigo: string,
  mensaje: string,
  restriccion?: string,
): ErrorTraducido {
  return { estado, cuerpo: restriccion ? { codigo, mensaje, restriccion } : { codigo, mensaje } };
}

/**
 * Convierte cualquier error en estado HTTP + cuerpo para el cliente. Los errores inesperados
 * se reducen a un mensaje genérico (el detalle solo va al log del servidor).
 */
export function traducirError(error: unknown): ErrorTraducido {
  if (error instanceof HttpException) return traducirHttp(error);
  if (error instanceof DatabaseError) return traducirBaseDatos(error);
  if (esErrorDeConexion(error)) return SIN_BASE_DATOS;
  if (esErrorHttpCliente(error)) return traducirErrorHttpCliente(error);
  return ERROR_INTERNO;
}

function traducirHttp(error: HttpException): ErrorTraducido {
  const estado = error.getStatus();
  const contenido = error.getResponse();

  // Errores propios de la API: new HttpException({ codigo, mensaje }, estado)
  if (
    typeof contenido === 'object' &&
    typeof (contenido as Partial<RespuestaError>).codigo === 'string' &&
    typeof (contenido as Partial<RespuestaError>).mensaje === 'string'
  ) {
    return { estado, cuerpo: contenido as RespuestaError };
  }
  if (estado >= 500) return { estado, cuerpo: ERROR_INTERNO.cuerpo };

  const codigo = CODIGO_POR_ESTADO[estado] ?? 'SOLICITUD_INVALIDA';
  const mensaje = error.message;

  // Mensajes en inglés que genera Nest/Express
  const ruta = /^Cannot (\w+) (.+)$/.exec(mensaje);
  if (estado === 404 && ruta)
    return respuesta(estado, codigo, `No existe la ruta ${ruta[1]} ${ruta[2]}`);
  if (estado === 400 && /\bJSON\b/.test(mensaje)) {
    return respuesta(estado, codigo, 'El cuerpo de la solicitud no es un JSON válido'); // body-parser
  }
  if (estado === 400 && mensaje.startsWith('Failed to decode param')) {
    return respuesta(estado, codigo, 'La ruta tiene caracteres mal codificados');
  }
  // Archivos subidos (multer)
  if (estado === 413) return respuesta(estado, codigo, 'El archivo es demasiado grande');
  if (estado === 400 && FORMULARIO_MAL_ARMADO.test(mensaje)) {
    return respuesta(estado, codigo, 'Adjunte un solo archivo, en el campo que indica la ruta');
  }
  return respuesta(estado, codigo, mensaje);
}

/**
 * Errores 4xx de los middlewares de Express (body-parser) que Nest no convierte en
 * HttpException: siguen la convención de http-errors ({ status, expose: true }).
 */
function esErrorHttpCliente(error: unknown): error is { status: number } {
  const status = propiedad(error, 'status');
  return (
    propiedad(error, 'expose') === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  );
}

function traducirErrorHttpCliente(error: { status: number }): ErrorTraducido {
  const codigo = CODIGO_POR_ESTADO[error.status] ?? 'SOLICITUD_INVALIDA';
  const mensaje =
    error.status === 413 ? 'La solicitud es demasiado grande' : 'La solicitud no es válida';
  return respuesta(error.status, codigo, mensaje);
}

/**
 * Errores lanzados por PostgreSQL. Los mensajes de las funciones fn_* y triggers (RAISE EXCEPTION)
 * ya están en español y pensados para el usuario: se reenvían tal cual. Los que genera el propio
 * PostgreSQL al violar una restricción (traen `constraint`) se reemplazan por un texto genérico.
 */
function traducirBaseDatos(error: DatabaseError): ErrorTraducido {
  const codigo = error.code ?? '';
  const restriccion = error.constraint;

  switch (codigo) {
    case '42501': // insufficient_privilege: fn_exigir_permiso / fn_exigir_sucursal
      return respuesta(403, 'PERMISO_DENEGADO', error.message);
    case 'P0001': // raise_exception: reglas del negocio
      return respuesta(422, 'REGLA_NEGOCIO', error.message);
    case '23514': // check_violation
      return restriccion
        ? respuesta(422, 'REGLA_NEGOCIO', 'Los datos no cumplen una regla del sistema', restriccion)
        : respuesta(422, 'REGLA_NEGOCIO', error.message);
    case '23001': // restrict_violation: tablas de solo inserción, borrados no permitidos
      return restriccion
        ? respuesta(
            409,
            'OPERACION_NO_PERMITIDA',
            'El registro está en uso y no se puede borrar',
            restriccion,
          )
        : respuesta(409, 'OPERACION_NO_PERMITIDA', error.message);
    case '23505': // unique_violation
      return respuesta(409, 'DUPLICADO', 'Ya existe un registro con esos datos', restriccion);
    case '23503': // foreign_key_violation
      return respuesta(
        409,
        'REFERENCIA_INVALIDA',
        'El registro hace referencia a datos que no existen o que están en uso',
        restriccion,
      );
    case '23502': // not_null_violation
      return respuesta(
        422,
        'DATO_FALTANTE',
        error.column ? `Falta el dato obligatorio "${error.column}"` : 'Falta un dato obligatorio',
      );
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return respuesta(
        409,
        'REINTENTAR',
        'La operación coincidió con otra al mismo tiempo. Intente de nuevo.',
      );
  }
  if (codigo.startsWith('22')) {
    return respuesta(400, 'DATO_INVALIDO', 'Un dato enviado tiene un formato o valor inválido');
  }
  // 08 conexión, 28 autenticación, 3D base inexistente, 53 recursos, 57P servidor apagándose
  if (/^(08|28|3D|53|57P)/.test(codigo)) return SIN_BASE_DATOS;
  return ERROR_INTERNO;
}

/** PostgreSQL inalcanzable. pg puede lanzar un AggregateError (intentó ::1 y 127.0.0.1) con `code`. */
function esErrorDeConexion(error: unknown): boolean {
  const codigo = propiedad(error, 'code');
  if (typeof codigo === 'string' && CODIGOS_RED.has(codigo)) return true;
  const mensaje = propiedad(error, 'message');
  return (
    typeof mensaje === 'string' &&
    /timeout exceeded when trying to connect|Connection terminated/i.test(mensaje)
  );
}

// Se leen propiedades en vez de usar `instanceof Error`: los errores del núcleo de Node pueden
// venir de otro contexto de JavaScript (p. ej. dentro de Jest) y ahí instanceof falla.
function propiedad(error: unknown, nombre: string): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[nombre]
    : undefined;
}
