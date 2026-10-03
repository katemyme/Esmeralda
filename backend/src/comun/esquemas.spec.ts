import { HttpException } from '@nestjs/common';
import {
  esquemaActiva,
  esquemaActivo,
  idDeCuerpo,
  idEntero,
  idUuid,
  monto,
  montoPositivo,
  textoOpcional,
} from './esquemas';

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

describe('esquemaActivo y esquemaActiva', () => {
  it('exigen un booleano', () => {
    expect(esquemaActivo.parse({ activo: false })).toEqual({ activo: false });
    for (const malo of [{}, { activo: 'false' }, { activo: 0 }, { activo: null }]) {
      expect(esquemaActivo.safeParse(malo).error?.issues[0].message).toBe(
        'Indique "activo": true o false',
      );
    }
    expect(esquemaActiva.parse({ activa: true })).toEqual({ activa: true });
    expect(esquemaActiva.safeParse({ activo: true }).error?.issues[0].message).toBe(
      'Indique "activa": true o false',
    );
  });
});

describe('monto', () => {
  const precio = monto('monto inválido');

  it('acepta número o texto y lo deja como texto exacto', () => {
    expect(precio.parse(650)).toBe('650');
    expect(precio.parse(650.5)).toBe('650.5');
    expect(precio.parse(' 1200.75 ')).toBe('1200.75');
    expect(precio.parse(0)).toBe('0');
  });

  it('rechaza negativos, más de 2 decimales, notación científica y lo que no es un monto', () => {
    for (const malo of [-1, 10.999, 0.1 + 0.2, 1e21, '1,50', 'abc', '', null, undefined, true]) {
      expect(precio.safeParse(malo).error?.issues[0].message).toBe('monto inválido');
    }
  });

  it('montoPositivo además exige que sea mayor que cero', () => {
    const positivo = montoPositivo('debe ser mayor que 0');
    expect(positivo.parse('0.01')).toBe('0.01');
    for (const malo of [0, '0.00', -5]) {
      expect(positivo.safeParse(malo).error?.issues[0].message).toBe('debe ser mayor que 0');
    }
  });
});

describe('idDeCuerpo', () => {
  it('acepta solo enteros positivos', () => {
    const id = idDeCuerpo('id inválido');
    expect(id.parse(7)).toBe(7);
    for (const malo of [0, -1, 1.5, '7', null, undefined]) {
      expect(id.safeParse(malo).error?.issues[0].message).toBe('id inválido');
    }
  });
});
