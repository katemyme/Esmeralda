import { afterEach, describe, expect, it } from 'vitest';
import type { PiezaEtiqueta } from '../api/tipos';
import {
  HOJA_DE_30,
  PAPEL_INICIAL,
  copiasIniciales,
  cuerpoDelPdf,
  guardarPapel,
  paginasDelPdf,
  papelGuardado,
  problemasDelPapel,
  totalDeEtiquetas,
  type Papel,
} from './papel';

const pieza = (variante_id: number, cantidad: number | null): PiezaEtiqueta => ({
  variante_id,
  codigo: `PTI-${String(variante_id).padStart(5, '0')}`,
  producto: 'Labret',
  variante: '6 mm',
  categoria: 'Piercing titanio',
  nombre: 'Labret · 6 mm',
  cantidad,
});

const hoja = (cambios: Partial<Papel['hoja']>): Papel => ({
  ...PAPEL_INICIAL,
  hoja: { ...HOJA_DE_30, ...cambios },
});

afterEach(() => localStorage.clear());

describe('problemasDelPapel: las mismas reglas que la API', () => {
  it('la hoja de 30 por defecto y la etiqueta de 50 × 30 sirven', () => {
    expect(problemasDelPapel(PAPEL_INICIAL)).toEqual({});
    expect(problemasDelPapel({ ...PAPEL_INICIAL, formato: 'ROLLO' })).toEqual({});
  });

  it('cada medida en su rango', () => {
    expect(problemasDelPapel(hoja({ filas: 0, ancho: 300, saltar: 1.5 }))).toEqual({
      filas: 'Un número entero de 1 a 30',
      ancho: 'De 15 a 200 mm',
      saltar: 'Un número entero de 0 a 299',
    });
    expect(problemasDelPapel(hoja({ margen_superior: Number.NaN }))).toEqual({
      margen_superior: 'De 0 a 100 mm',
    });
    expect(
      problemasDelPapel({ ...PAPEL_INICIAL, formato: 'ROLLO', rollo: { ancho: 5, alto: 30 } }),
    ).toEqual({ rollo_ancho: 'De 15 a 110 mm' });
  });

  it('la cuadrícula tiene que caber en la hoja carta, y no se saltan más de las que tiene', () => {
    expect(problemasDelPapel(hoja({ columnas: 4, ancho: 60, filas: 11 }))).toEqual({
      columnas: 'No caben a lo ancho de la hoja: ocupan 254.4 mm de 215.9',
      filas: 'No caben a lo alto de la hoja: ocupan 292.1 mm de 279.4',
    });
    expect(problemasDelPapel(hoja({ saltar: 30 }))).toEqual({
      saltar: 'La hoja tiene 30 etiquetas',
    });
    expect(problemasDelPapel(hoja({ saltar: 29 }))).toEqual({});
  });
});

describe('lo que se pide', () => {
  it('las copias que se proponen: lo que hay (o 1 si no se ve), sin pasar de 500', () => {
    expect(copiasIniciales(pieza(1, 8))).toBe(8);
    expect(copiasIniciales(pieza(1, null))).toBe(1);
    expect(copiasIniciales(pieza(1, 0))).toBe(1);
    expect(copiasIniciales(pieza(1, 1200))).toBe(500);
  });

  it('solo van las piezas con copias, y el papel que se eligió', () => {
    const lista = [
      { pieza: pieza(1, 8), copias: 8 },
      { pieza: pieza(2, 3), copias: 0 },
      { pieza: pieza(3, null), copias: 2 },
    ];
    expect(totalDeEtiquetas(lista)).toBe(10);
    expect(cuerpoDelPdf(lista, PAPEL_INICIAL)).toEqual({
      formato: 'HOJA',
      piezas: [
        { variante_id: 1, copias: 8 },
        { variante_id: 3, copias: 2 },
      ],
      hoja: HOJA_DE_30,
    });
    expect(cuerpoDelPdf(lista, { ...PAPEL_INICIAL, formato: 'ROLLO' })).toEqual({
      formato: 'ROLLO',
      piezas: [
        { variante_id: 1, copias: 8 },
        { variante_id: 3, copias: 2 },
      ],
      rollo: { ancho: 50, alto: 30 },
    });
  });

  it('cuántas hojas salen (con las ya usadas de la primera) o cuántas páginas', () => {
    expect(paginasDelPdf(30, PAPEL_INICIAL)).toBe(1);
    expect(paginasDelPdf(31, PAPEL_INICIAL)).toBe(2);
    expect(paginasDelPdf(10, hoja({ saltar: 25 }))).toBe(2);
    expect(paginasDelPdf(7, { ...PAPEL_INICIAL, formato: 'ROLLO' })).toBe(7);
  });
});

describe('el papel que recuerda este equipo', () => {
  it('guarda las medidas, pero no las ya usadas ni los bordes', () => {
    expect(papelGuardado()).toEqual(PAPEL_INICIAL);
    guardarPapel({
      formato: 'ROLLO',
      hoja: { ...HOJA_DE_30, filas: 8, saltar: 5, bordes: true },
      rollo: { ancho: 40, alto: 25 },
    });
    expect(papelGuardado()).toEqual({
      formato: 'ROLLO',
      hoja: { ...HOJA_DE_30, filas: 8 },
      rollo: { ancho: 40, alto: 25 },
    });
  });

  it('lo que no sirve (o no se puede leer) vuelve al papel de siempre', () => {
    localStorage.setItem('esmeralda.etiquetas.papel', '{roto');
    expect(papelGuardado()).toEqual(PAPEL_INICIAL);
    localStorage.setItem(
      'esmeralda.etiquetas.papel',
      JSON.stringify({ formato: 'HOJA', hoja: { columnas: 9 }, rollo: {} }),
    );
    expect(papelGuardado()).toEqual(PAPEL_INICIAL); // 9 columnas de 66.7 mm no caben
    localStorage.setItem(
      'esmeralda.etiquetas.papel',
      JSON.stringify({ formato: 'ROLLO', hoja: {}, rollo: { ancho: 'cincuenta' } }),
    );
    expect(papelGuardado()).toEqual(PAPEL_INICIAL);
  });
});
