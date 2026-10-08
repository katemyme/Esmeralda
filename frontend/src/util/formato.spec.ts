import { describe, expect, it } from 'vitest';
import { formatoFechaHora, formatoHora, formatoMonto, primerNombre } from './formato';

describe('formato', () => {
  it('los montos de la API salen con dos decimales, separador de miles y su moneda', () => {
    expect(formatoMonto('1250.5')).toBe('C$ 1,250.50');
    expect(formatoMonto('20', 'USD')).toBe('US$ 20.00');
    expect(formatoMonto(0)).toBe('C$ 0.00');
  });

  it('las fechas se muestran en la hora de Managua, esté donde esté el equipo', () => {
    // 21:42 UTC son las 15:42 en Managua (UTC−6, sin horario de verano)
    expect(formatoFechaHora('2026-10-07T21:42:00.000Z')).toMatch(
      /^07\/10\/2026, 03:42\s?p\.\s?m\.$/,
    );
    expect(formatoHora('2026-10-08T03:05:00.000Z')).toMatch(/^09:05\s?p\.\s?m\.$/);
  });

  it('el primer nombre, para los botones y la barra', () => {
    expect(primerNombre('  María José López ')).toBe('María');
    expect(primerNombre('Ana')).toBe('Ana');
  });
});
