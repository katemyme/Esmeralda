import { esquemaLogin, esquemaPasswordNueva } from './esquemas';

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
