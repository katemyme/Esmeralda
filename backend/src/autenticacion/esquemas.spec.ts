import {
  esquemaEntrarConPin,
  esquemaLogin,
  esquemaPasswordNueva,
  esquemaPinNuevo,
} from './esquemas';

describe('esquemaLogin', () => {
  it('normaliza el usuario: sin espacios y en minúsculas', () => {
    expect(esquemaLogin.parse({ username: '  Ana.Martinez ', password: 'x' })).toEqual({
      username: 'ana.martinez',
      password: 'x',
    });
  });

  it('exige usuario y contraseña, con mensajes en español', () => {
    const resultado = esquemaLogin.safeParse({ username: ' ' });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues.map((i) => i.message)).toEqual([
      'Escriba su usuario',
      'Escriba su contraseña',
    ]);
  });
});

describe('política de contraseñas', () => {
  const mensaje = (password: string) =>
    esquemaPasswordNueva.safeParse(password).error?.issues[0].message;

  it('acepta 8 o más caracteres con letras y números', () => {
    expect(esquemaPasswordNueva.safeParse('Esmeralda1').success).toBe(true);
    expect(esquemaPasswordNueva.safeParse('ñandú2026').success).toBe(true);
  });

  it('rechaza contraseñas cortas, sin letras o sin números', () => {
    expect(mensaje('Ab1')).toBe('La nueva contraseña debe tener al menos 8 caracteres');
    expect(mensaje('12345678')).toBe('La nueva contraseña debe incluir al menos una letra');
    expect(mensaje('solamente')).toBe('La nueva contraseña debe incluir al menos un número');
    expect(mensaje('a1'.repeat(65))).toBe('La nueva contraseña es demasiado larga');
  });
});

describe('esquemaPinNuevo', () => {
  it('acepta 4 dígitos que no sean triviales', () => {
    for (const pin of ['2580', '9630', '1357', '0042', '1235']) {
      expect(esquemaPinNuevo.parse(pin)).toBe(pin);
    }
  });

  it('rechaza lo que no son exactamente 4 dígitos', () => {
    for (const pin of ['', '123', '12345', '12a4', ' 258', 2580]) {
      expect(esquemaPinNuevo.safeParse(pin).success).toBe(false);
    }
  });

  it('rechaza el mismo dígito cuatro veces y las escaleras, hacia arriba o hacia abajo', () => {
    for (const pin of ['0000', '7777', '0123', '1234', '6789', '9876', '4321', '3210']) {
      expect(esquemaPinNuevo.safeParse(pin).error?.issues[0].message).toBe(
        'Ese PIN es muy fácil de adivinar: no use 0000, 1234 ni parecidos',
      );
    }
  });
});

describe('esquemaEntrarConPin', () => {
  it('pide a quién y un PIN de 4 dígitos (aquí no importa si es trivial: se compara con el guardado)', () => {
    expect(esquemaEntrarConPin.parse({ usuario_id: 7, pin: '0000' })).toEqual({
      usuario_id: 7,
      pin: '0000',
    });
    const invalido = esquemaEntrarConPin.safeParse({ usuario_id: 'siete', pin: '12' });
    expect(invalido.error?.issues.map((i) => i.path[0])).toEqual(['usuario_id', 'pin']);
  });
});
