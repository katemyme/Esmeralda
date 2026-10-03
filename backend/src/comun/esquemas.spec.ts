import { HttpException } from '@nestjs/common';
import { esquemaActivo, idEntero, idUuid, textoOpcional } from './esquemas';

function errorDe(accion: () => unknown): unknown {
  try {
    accion();
  } catch (error) {
    return (error as HttpException).getResponse();
  }
  throw new Error('se esperaba un error');
}

describe('ids de la ruta', () => {
  it('idEntero convierte el texto de la ruta en número', () => {
    expect(idEntero().transform('42')).toBe(42);
  });

  it('idEntero rechaza lo que no es un id → 400 con el nombre del campo', () => {
    for (const malo of ['abc', '0', '-1', '1.5', '12abc', '', '1'.repeat(16)]) {
      expect(errorDe(() => idEntero().transform(malo))).toEqual({
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'El identificador de la ruta no es válido',
        errores: [{ campo: 'id', mensaje: 'El identificador de la ruta no es válido' }],
      });
    }
  });

  it('idUuid acepta un UUID y rechaza lo demás', () => {
    const id = '3f2b8c1e-7a4d-4e9b-9c55-0d6a1b2c3d4e';
    expect(idUuid().transform(id)).toBe(id);
    for (const malo of ['abc', '42', `${id}x`, "'; drop table dispositivo; --"]) {
      expect(errorDe(() => idUuid().transform(malo))).toMatchObject({
        codigo: 'DATOS_INVALIDOS',
        errores: [{ campo: 'id', mensaje: 'El identificador de la ruta no es válido' }],
      });
    }
  });
});

describe('textoOpcional', () => {
  const esquema = textoOpcional(10, 'demasiado largo');

  it('ausente, null o en blanco → null; lo demás, sin espacios alrededor', () => {
    expect(esquema.parse(undefined)).toBeNull();
    expect(esquema.parse(null)).toBeNull();
    expect(esquema.parse('   ')).toBeNull();
    expect(esquema.parse('  hola ')).toBe('hola');
  });

  it('respeta el máximo', () => {
    expect(esquema.safeParse('x'.repeat(11)).error?.issues[0].message).toBe('demasiado largo');
  });
});

describe('esquemaActivo', () => {
  it('exige un booleano', () => {
    expect(esquemaActivo.parse({ activo: false })).toEqual({ activo: false });
    for (const malo of [{}, { activo: 'false' }, { activo: 0 }, { activo: null }]) {
      expect(esquemaActivo.safeParse(malo).error?.issues[0].message).toBe(
        'Indique "activo": true o false',
      );
    }
  });
});
