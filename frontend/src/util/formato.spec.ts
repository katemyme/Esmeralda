import { describe, expect, it } from 'vitest';
import {
  formatoDia,
  formatoFecha,
  formatoFechaHora,
  formatoHora,
  formatoMonto,
  hoyEnManagua,
  nombreDeDia,
  primerNombre,
  sumarDias,
} from './formato';

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

  it('los días: el de un instante en Managua, y los que la API entrega como AAAA-MM-DD', () => {
    // las 03:05 UTC del día 8 todavía son el 7 en Managua
    expect(formatoFecha('2026-10-08T03:05:00.000Z')).toBe('07/10/2026');
    expect(hoyEnManagua(new Date('2026-10-08T03:05:00.000Z'))).toBe('2026-10-07');
    expect(formatoDia('2026-10-15')).toBe('15/10/2026');
    expect(sumarDias('2026-10-01', -7)).toBe('2026-09-24');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(nombreDeDia('2026-10-12', '2026-10-12')).toBe('Hoy');
    expect(nombreDeDia('2026-10-11', '2026-10-12')).toBe('Ayer');
    expect(nombreDeDia('2026-10-10', '2026-10-12')).toBe('sábado 10/10/2026');
  });

  it('el primer nombre, para los botones y la barra', () => {
    expect(primerNombre('  María José López ')).toBe('María');
    expect(primerNombre('Ana')).toBe('Ana');
  });
});
