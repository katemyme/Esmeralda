import { describe, expect, it } from 'vitest';
import { solicitud } from '../pruebas/devoluciones';
import { cuentaDelCambio, estadosCambiados, estadosIniciales } from './ejecucion';

describe('el estado en que se recibe cada línea', () => {
  const { lineas } = solicitud(); // la cadena se pidió defectuosa; los dos perfumes, en buen estado

  it('de entrada, el que se pidió', () => {
    expect(estadosIniciales(lineas)).toEqual({ 1: 'DEFECTUOSO', 2: 'BUENO' });
  });

  it('solo se envía lo que llega distinto de como se pidió', () => {
    expect(estadosCambiados(lineas, estadosIniciales(lineas))).toEqual([]);
    expect(estadosCambiados(lineas, { 1: 'BUENO', 2: 'BUENO' })).toEqual([
      { id: 1, estado: 'BUENO' },
    ]);
    expect(estadosCambiados(lineas, { 1: 'DEFECTUOSO', 2: 'DEFECTUOSO' })).toEqual([
      { id: 2, estado: 'DEFECTUOSO' },
    ]);
    // una línea que no es de la devolución no se envía
    expect(estadosCambiados(lineas, { 1: 'DEFECTUOSO', 2: 'BUENO', 9: 'BUENO' })).toEqual([]);
  });
});

describe('la cuenta del cambio', () => {
  it('lo nuevo cuesta más: se aplica todo lo devuelto y se cobra la diferencia', () => {
    expect(cuentaDelCambio(60000, 120000)).toEqual({
      aplicado: 60000,
      porCobrar: 60000,
      sobrante: 0,
    });
  });

  it('lo nuevo cuesta menos: lo que sobra se le entrega', () => {
    expect(cuentaDelCambio(60000, 35000)).toEqual({
      aplicado: 35000,
      porCobrar: 0,
      sobrante: 25000,
    });
  });

  it('cuesta lo mismo: ni se cobra ni se entrega nada', () => {
    expect(cuentaDelCambio(52000, 52000)).toEqual({ aplicado: 52000, porCobrar: 0, sobrante: 0 });
  });
});
