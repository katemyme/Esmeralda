import bcrypt from 'bcryptjs';
import { esquemaPasswordNueva } from './esquemas';
import {
  generarPasswordTemporal,
  generarToken,
  hashearPassword,
  hashParaUsuarioInexistente,
  sha256,
  verificarPassword,
} from './seguridad';

describe('tokens', () => {
  it('generarToken: 256 bits en base64url, distinto cada vez', () => {
    const a = generarToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generarToken()).not.toBe(a);
  });

  it('sha256 en hexadecimal (64 caracteres, como la columna de la base)', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('contraseñas', () => {
  it('las nuevas se guardan con argon2id y se verifican', async () => {
    const hash = await hashearPassword('Clave#2026');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('Clave#2026');
    expect(await verificarPassword('Clave#2026', hash)).toBe(true);
    expect(await verificarPassword('clave#2026', hash)).toBe(false);
  });

  it('acepta los hashes bcrypt del seed ($2a$, como los crea crypt() de PostgreSQL)', async () => {
    // bcryptjs genera $2b$; $2a$ es el mismo algoritmo (el login e2e usa el hash real del seed)
    const hash = bcrypt.hashSync('Demo#2026', 4).replace(/^\$2b\$/, '$2a$');
    expect(await verificarPassword('Demo#2026', hash)).toBe(true);
    expect(await verificarPassword('Demo#2025', hash)).toBe(false);
  });

  it('un hash dañado o desconocido nunca deja pasar', async () => {
    expect(await verificarPassword('x', '$argon2id$dañado')).toBe(false);
    expect(await verificarPassword('x', 'texto-plano')).toBe(false);
    expect(await verificarPassword('', '')).toBe(false);
  });

  it('la contraseña temporal es fácil de dictar, cumple la política y no se repite', () => {
    const generadas = Array.from({ length: 200 }, () => generarPasswordTemporal());
    for (const password of generadas) {
      // tres grupos de 4, sin caracteres que se confunden (0/o, 1/l/i)
      expect(password).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
      expect(esquemaPasswordNueva.safeParse(password).success).toBe(true);
    }
    expect(new Set(generadas).size).toBe(200);
  });

  it('el hash para usuarios inexistentes es argon2id y siempre el mismo', async () => {
    const hash = await hashParaUsuarioInexistente();
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await hashParaUsuarioInexistente()).toBe(hash);
    expect(await verificarPassword('', hash)).toBe(false);
  });
});
