import { esquemaActualizarUsuario, esquemaCrearUsuario } from './esquemas';

function mensajes(esquema: typeof esquemaCrearUsuario, datos: unknown): Record<string, string> {
  const resultado = esquema.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );
}

describe('esquemaCrearUsuario', () => {
  it('normaliza: nombre y usuario sin espacios, usuario en minúsculas, rol en mayúsculas', () => {
    expect(
      esquemaCrearUsuario.parse({
        nombre_completo: '  Rosa Gómez ',
        username: ' Rosa.Gomez ',
        rol: 'vendedor',
        sucursales: [2, 1, 2],
        email: ' rosa@example.com ',
        telefono: ' 8888-1234 ',
      }),
    ).toEqual({
      nombre_completo: 'Rosa Gómez',
      username: 'rosa.gomez',
      rol: 'VENDEDOR',
      sucursales: [2, 1],
      email: 'rosa@example.com',
      telefono: '8888-1234',
    });
  });

  it('sucursales, correo y teléfono son opcionales (vacío → null)', () => {
    expect(
      esquemaCrearUsuario.parse({
        nombre_completo: 'Rosa Gómez',
        username: 'rosa.gomez',
        rol: 'VENDEDOR',
        email: '',
      }),
    ).toMatchObject({ sucursales: [], email: null, telefono: null });
  });

  it('mensajes en español por campo', () => {
    expect(mensajes(esquemaCrearUsuario, {})).toEqual({
      nombre_completo: 'Escriba el nombre completo',
      username: 'Escriba el nombre de usuario',
      rol: 'Indique el rol',
    });
    expect(
      mensajes(esquemaCrearUsuario, {
        nombre_completo: 'Ro',
        username: 'Rosa Gómez',
        rol: 'jefe-1',
        sucursales: [1, 'dos'],
        email: 'rosa@',
        telefono: '8'.repeat(21),
      }),
    ).toEqual({
      nombre_completo: 'El nombre debe tener al menos 3 caracteres',
      username:
        'El usuario debe tener de 3 a 40 caracteres: letras sin tilde, números, punto o guion bajo',
      rol: 'El rol no es válido',
      'sucursales.1': 'Cada sucursal se indica con su id',
      email: 'El correo no es válido',
      telefono: 'El teléfono es demasiado largo',
    });
  });
});

describe('esquemaActualizarUsuario', () => {
  it('exige las sucursales: al editar reemplazan a las anteriores', () => {
    const resultado = esquemaActualizarUsuario.safeParse({
      nombre_completo: 'Rosa Gómez',
      rol: 'VENDEDOR',
    });
    expect(resultado.error?.issues.map((i) => i.message)).toEqual([
      'Indique las sucursales del usuario (lista de ids; puede ir vacía)',
    ]);
  });

  it('no permite cambiar el nombre de usuario (se ignora si se envía)', () => {
    expect(
      esquemaActualizarUsuario.parse({
        nombre_completo: 'Rosa Gómez',
        username: 'otro',
        rol: 'ENCARGADO',
        sucursales: [],
      }),
    ).toEqual({
      nombre_completo: 'Rosa Gómez',
      rol: 'ENCARGADO',
      sucursales: [],
      email: null,
      telefono: null,
    });
  });
});
