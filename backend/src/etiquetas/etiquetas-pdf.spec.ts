import { leerPaginas, loQueSeSale, type PaginaPdf, type TrazoPdf } from '../../test/textos-pdf';
import { matrizQr } from '../exportacion/qr';
import { esquemaCuadricula } from './esquemas';
import {
  CARTA_MM,
  etiquetasEnHoja,
  etiquetasEnRollo,
  posicionEnHoja,
  type Etiqueta,
} from './etiquetas-pdf';

interface Caja {
  izquierda: number;
  arriba: number;
  derecha: number;
  abajo: number;
}

const HOLGURA = 0.01; // redondeo de los números del PDF

/** Los cuadros del QR que quedaron dentro de la caja, vueltos a juntar como cuadrícula de módulos. */
function qrDibujado(trazos: TrazoPdf[], caja: Caja): boolean[][] {
  const cuadros = trazos.filter(
    (t) =>
      t.arriba !== undefined &&
      t.abajo !== undefined &&
      t.izquierda >= caja.izquierda - HOLGURA &&
      t.derecha <= caja.derecha + HOLGURA &&
      t.arriba >= caja.arriba - HOLGURA &&
      t.abajo <= caja.abajo + HOLGURA,
  ) as Required<TrazoPdf>[];
  const modulo = Math.min(...cuadros.map((t) => t.abajo - t.arriba));
  const x0 = Math.min(...cuadros.map((t) => t.izquierda));
  const y0 = Math.min(...cuadros.map((t) => t.arriba));
  const lado = Math.round((Math.max(...cuadros.map((t) => t.derecha)) - x0) / modulo);
  const matriz = Array.from({ length: lado }, () => Array<boolean>(lado).fill(false));
  for (const t of cuadros) {
    const fila = Math.round((t.arriba - y0) / modulo);
    for (
      let c = Math.round((t.izquierda - x0) / modulo);
      c < Math.round((t.derecha - x0) / modulo);
      c++
    ) {
      matriz[fila][c] = true;
    }
  }
  return matriz;
}

/** Lo que se sale de la caja, a lo ancho o a lo alto (textos por su línea de base). */
function seSaleDe(pagina: PaginaPdf, caja: Caja): string[] {
  const enAncho = loQueSeSale(pagina, { desde: caja.izquierda, hasta: caja.derecha });
  const enAlto = [
    ...pagina.textos
      .filter((t) => t.y < caja.arriba - HOLGURA || t.y > caja.abajo + HOLGURA)
      .map((t) => `«${t.texto}» va a ${t.y.toFixed(2)} mm de arriba`),
    ...pagina.trazos
      .filter(
        (t) =>
          t.arriba !== undefined &&
          (t.arriba < caja.arriba - HOLGURA || (t.abajo ?? 0) > caja.abajo + HOLGURA),
      )
      .map((t) => `un cuadro va de ${t.arriba?.toFixed(2)} a ${t.abajo?.toFixed(2)} mm de arriba`),
  ];
  return [...enAncho, ...enAlto];
}

/** Lo de la página que cae dentro de la caja. */
function dentroDe(pagina: PaginaPdf, caja: Caja): PaginaPdf {
  const enLaCaja = (izquierda: number, y: number) =>
    izquierda >= caja.izquierda - HOLGURA &&
    izquierda <= caja.derecha &&
    y >= caja.arriba - HOLGURA &&
    y <= caja.abajo + HOLGURA;
  return {
    ...pagina,
    textos: pagina.textos.filter((t) => enLaCaja(t.izquierda, t.y)),
    trazos: pagina.trazos.filter((t) => enLaCaja(t.izquierda, t.arriba ?? 0)),
  };
}

const LABRET: Etiqueta = {
  codigo: 'PTI-00001',
  nombre: 'Labret rosca interna · Titanio · 16G · 6 mm',
};
const LARGA: Etiqueta = {
  codigo: 'JDU-00012',
  nombre:
    'Collar estilo Dubái con dije de media luna y piedras de colores · Dorado · 45 cm con extensión de 5 cm',
};
const MUY_LARGA: Etiqueta = {
  codigo: 'JDU-00013',
  nombre: Array.from({ length: 4 }, () => LARGA.nombre).join(' '),
};
const DE_FABRICA: Etiqueta = {
  codigo: '7501234567890123456789012345678901234567',
  nombre: 'Perfume',
};

describe('etiquetasEnRollo: una etiqueta por página', () => {
  it('cada copia en su página, del tamaño de la etiqueta, con el QR del código, el código y el nombre', async () => {
    const pdf = await etiquetasEnRollo([LABRET, LABRET, MUY_LARGA, LARGA], { ancho: 50, alto: 30 });
    const paginas = leerPaginas(pdf);
    expect(paginas).toHaveLength(4);
    for (const pagina of paginas) {
      expect(pagina.ancho).toBeCloseTo(50, 2);
      expect(pagina.alto).toBeCloseTo(30, 2);
      expect(seSaleDe(pagina, { izquierda: 0, arriba: 0, derecha: 50, abajo: 30 })).toEqual([]);
      // la letra se achica para que quepa, pero nunca a menos de 5 puntos
      expect(Math.min(...pagina.textos.map((t) => t.letra))).toBeGreaterThanOrEqual(5);
    }
    const [primera, , tercera] = paginas;
    expect(primera.textos[0]).toMatchObject({ texto: 'PTI-00001', fuente: 'Helvetica-Bold' });
    expect(
      primera.textos
        .slice(1)
        .map((t) => t.texto)
        .join(' '),
    ).toBe(LABRET.nombre);
    // el QR lleva solo el código, y a la izquierda del texto (etiqueta apaisada)
    const caja = { izquierda: 0, arriba: 0, derecha: 50, abajo: 30 };
    expect(qrDibujado(primera.trazos, caja)).toEqual(matrizQr('PTI-00001'));
    const finDelQr = Math.max(...primera.trazos.map((t) => t.derecha));
    expect(Math.min(...primera.textos.map((t) => t.izquierda))).toBeGreaterThan(finDelQr);
    // un nombre que no cabe ni con la letra más chica se corta con «…» (sin salirse)
    expect(tercera.textos.at(-1)?.texto).toMatch(/…$/);
    expect(qrDibujado(tercera.trazos, caja)).toEqual(matrizQr('JDU-00013'));
    // uno largo que sí cabe achicando la letra va completo
    expect(
      paginas[3].textos
        .slice(1)
        .map((t) => t.texto)
        .join(' '),
    ).toBe(LARGA.nombre);
  });

  it('en una etiqueta alta o cuadrada el QR va arriba y el texto debajo, centrado', async () => {
    const [pagina] = leerPaginas(await etiquetasEnRollo([LABRET], { ancho: 40, alto: 50 }));
    expect(seSaleDe(pagina, { izquierda: 0, arriba: 0, derecha: 40, abajo: 50 })).toEqual([]);
    const pieDelQr = Math.max(...pagina.trazos.map((t) => t.abajo ?? 0));
    expect(Math.min(...pagina.textos.map((t) => t.y))).toBeGreaterThan(pieDelQr);
    const codigo = pagina.textos[0];
    expect(codigo.texto).toBe('PTI-00001');
    expect((codigo.izquierda + codigo.derecha) / 2).toBeCloseTo(20, 0);
    expect(qrDibujado(pagina.trazos, { izquierda: 0, arriba: 0, derecha: 40, abajo: 50 })).toEqual(
      matrizQr('PTI-00001'),
    );
  });

  it('ni la más chica (15 × 10 mm) ni un código de fábrica muy largo se salen de la etiqueta', async () => {
    for (const tamano of [
      { ancho: 15, alto: 10 },
      { ancho: 25, alto: 15 },
      { ancho: 110, alto: 200 },
    ]) {
      for (const pagina of leerPaginas(await etiquetasEnRollo([LARGA, DE_FABRICA], tamano))) {
        expect(
          seSaleDe(pagina, { izquierda: 0, arriba: 0, derecha: tamano.ancho, abajo: tamano.alto }),
        ).toEqual([]);
      }
    }
  });
});

describe('etiquetasEnHoja: hoja carta con cuadrícula', () => {
  const avery = esquemaCuadricula.parse({}); // 3 × 10 de 66.7 × 25.4 mm

  const cajaDe = (posicion: number): Caja => {
    const { x, y } = posicionEnHoja(avery, posicion);
    return { izquierda: x, arriba: y, derecha: x + avery.ancho, abajo: y + avery.alto };
  };

  it('por defecto, la hoja de 30 adhesivas: la cuadrícula cabe en la carta', () => {
    expect(avery).toMatchObject({ filas: 10, columnas: 3, ancho: 66.7, alto: 25.4 });
    const ultima = cajaDe(29);
    expect(ultima.derecha).toBeLessThanOrEqual(CARTA_MM.ancho);
    expect(ultima.abajo).toBeLessThanOrEqual(CARTA_MM.alto);
  });

  it('llena fila por fila y sigue en otra hoja; cada etiqueta queda dentro de su lugar', async () => {
    const etiquetas = Array.from({ length: 32 }, (_, i) => ({
      codigo: `PTI-${String(i + 1).padStart(5, '0')}`,
      nombre: i % 2 ? LARGA.nombre : LABRET.nombre,
    }));
    const paginas = leerPaginas(await etiquetasEnHoja(etiquetas, avery));
    expect(paginas).toHaveLength(2);
    expect(paginas[0].ancho).toBeCloseTo(CARTA_MM.ancho, 1);
    expect(paginas[0].alto).toBeCloseTo(CARTA_MM.alto, 1);
    const codigos = (p: PaginaPdf) =>
      p.textos.filter((t) => t.fuente === 'Helvetica-Bold').map((t) => t.texto);
    expect(codigos(paginas[0])).toHaveLength(30);
    expect(codigos(paginas[1])).toEqual(['PTI-00031', 'PTI-00032']);

    for (const [posicion, etiqueta] of etiquetas.entries()) {
      const pagina = paginas[Math.floor(posicion / 30)];
      const caja = cajaDe(posicion);
      const suya = dentroDe(pagina, caja);
      expect([etiqueta.codigo, seSaleDe(suya, caja)]).toEqual([etiqueta.codigo, []]);
      expect(codigos(suya)).toEqual([etiqueta.codigo]);
      expect(qrDibujado(suya.trazos, caja)).toEqual(matrizQr(etiqueta.codigo));
    }
  });

  it('las ya usadas de una hoja empezada se dejan en blanco', async () => {
    const cuadricula = { ...avery, saltar: 5 };
    const [pagina] = leerPaginas(await etiquetasEnHoja([LABRET], cuadricula));
    expect(dentroDe(pagina, cajaDe(4)).textos).toEqual([]);
    expect(dentroDe(pagina, cajaDe(5)).textos[0].texto).toBe('PTI-00001');
    // quedan 25 libres: 25 etiquetas caben en la primera hoja; la 26 ya va en otra
    const lleno = Array.from({ length: 26 }, () => LABRET);
    expect(leerPaginas(await etiquetasEnHoja(lleno, cuadricula))).toHaveLength(2);
    expect(leerPaginas(await etiquetasEnHoja(lleno.slice(1), cuadricula))).toHaveLength(1);
  });

  it('con bordes dibuja el contorno de cada lugar, para probar en papel normal', async () => {
    const [pagina] = leerPaginas(await etiquetasEnHoja([LABRET], { ...avery, bordes: true }));
    const contornos = pagina.trazos.filter(
      (t) => Math.abs(t.derecha - t.izquierda - avery.ancho) < 0.01,
    );
    expect(contornos).toHaveLength(30);
  });

  it('textos con tildes y signos del español', async () => {
    const [pagina] = leerPaginas(
      await etiquetasEnRollo([{ codigo: 'JDU-00001', nombre: 'Pulsera Dubái — Ñandú' }], {
        ancho: 60,
        alto: 30,
      }),
    );
    expect(pagina.textos.map((t) => t.texto)).toEqual(['JDU-00001', 'Pulsera Dubái — Ñandú']);
  });
});
