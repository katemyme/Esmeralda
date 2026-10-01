import { argon2id, hash, verify } from 'argon2';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

/** Token aleatorio de 256 bits para sesiones y equipos (se entrega en una cookie). */
export function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 en hexadecimal: lo único que se guarda de cada token en la base. */
export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/** Hash de una contraseña nueva (argon2id). */
export function hashearPassword(password: string): Promise<string> {
  return hash(password, { type: argon2id });
}

/**
 * Verifica una contraseña contra su hash: argon2id (todas las nuevas) o bcrypt ($2a$/$2b$/$2y$:
 * usuarios creados por el seed con crypt(); deben cambiarla al entrar y pasa a argon2id).
 */
export async function verificarPassword(password: string, hashGuardado: string): Promise<boolean> {
  try {
    if (hashGuardado.startsWith('$argon2')) return await verify(hashGuardado, password);
    if (/^\$2[aby]\$/.test(hashGuardado)) return await bcrypt.compare(password, hashGuardado);
  } catch {
    // hash con formato dañado: se trata como contraseña incorrecta
  }
  return false;
}

let hashFalso: Promise<string> | undefined;

/**
 * Hash de una contraseña al azar. Si el usuario no existe se verifica contra él de todos modos,
 * para que la respuesta tarde lo mismo y no delate qué nombres de usuario existen.
 */
export function hashParaUsuarioInexistente(): Promise<string> {
  hashFalso ??= hashearPassword(generarToken());
  return hashFalso;
}
