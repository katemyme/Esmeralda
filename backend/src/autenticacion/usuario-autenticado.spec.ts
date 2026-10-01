import { contenidoToken, usuarioDesdeToken, type UsuarioAutenticado } from './usuario-autenticado';

describe('contenido del token de acceso', () => {
  const vendedora: UsuarioAutenticado = {
    id: 3,
    sesionId: '6f1c2a54-0d1e-4b8f-9a39-2f1f6d0c9b11',
    rol: 'VENDEDOR',
    debeCambiarPassword: false,
    equipo: { id: '0c5d3c86-6a52-4a1d-9e5c-3c2f8b0b7a10', sucursalId: 1, cajaId: 1 },
  };

  it('ida y vuelta sin perder datos', () => {
    expect(usuarioDesdeToken(contenidoToken(vendedora))).toEqual(vendedora);
    expect(usuarioDesdeToken(contenidoToken({ ...vendedora, equipo: null }))).toEqual({
      ...vendedora,
      equipo: null,
    });
  });

  it('usa nombres cortos (viaja en cada solicitud)', () => {
    expect(contenidoToken(vendedora)).toEqual({
      sub: '3',
      sid: vendedora.sesionId,
      rol: 'VENDEDOR',
      dcp: false,
      eq: { id: vendedora.equipo?.id, suc: 1, caja: 1 },
    });
  });

  it('rechaza un contenido sin usuario o sin sesión', () => {
    const base = contenidoToken(vendedora);
    expect(() => usuarioDesdeToken({ ...base, sub: 'abc' })).toThrow('contenido inválido');
    expect(() => usuarioDesdeToken({ ...base, sub: '0' })).toThrow('contenido inválido');
    expect(() => usuarioDesdeToken({ ...base, sid: undefined as unknown as string })).toThrow(
      'contenido inválido',
    );
  });
});
