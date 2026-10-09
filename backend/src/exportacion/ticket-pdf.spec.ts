import PDFDocument from 'pdfkit';
import { leerPdf, loQueSeSale, type PaginaPdf } from '../../test/textos-pdf';
import { aBuffer } from './pdf';
import { ANCHO_TICKET, MARGEN_TICKET, ticketPdf, type Renglon } from './ticket-pdf';

const MM_POR_PUNTO = 25.4 / 72;
const ANCHO = 72; // mm: lo que imprime el cabezal en un rollo de 80
const MARGEN = MARGEN_TICKET * MM_POR_PUNTO;

const pagina = async (renglones: Renglon[]): Promise<PaginaPdf> =>
  leerPdf(await ticketPdf(renglones, 'Ticket'));
const escrito = (p: PaginaPdf) => p.textos.map((t) => t.texto);

describe('ticketPdf: el ticket cabe en lo que imprime un rollo de 80 mm', () => {
  it('la página mide 72 mm de ancho, con 2 mm de margen a cada lado', async () => {
    expect(ANCHO_TICKET * MM_POR_PUNTO).toBeCloseTo(ANCHO, 5);
    expect(MARGEN).toBeCloseTo(2, 5);
    const p = await pagina([{ tipo: 'texto', texto: 'Esmeralda Experience' }]);
    expect(p.ancho).toBeCloseTo(ANCHO, 2);
    expect(escrito(p)).toEqual(['Esmeralda Experience']);
    expect(p.textos[0].izquierda).toBeCloseTo(MARGEN, 2);
  });

  it('ningún texto pasa de 72 mm de ancho, por largos que vengan los datos', async () => {
    const referencia = `REF-${'0123456789'.repeat(8)}`; // una sola palabra más ancha que el ticket
    const renglones: Renglon[] = [
      {
        tipo: 'texto',
        texto: 'Esmeralda Experience Joyería y Perforaciones de Nicaragua',
        centrado: true,
        negrita: true,
        grande: true,
      },
      {
        tipo: 'texto',
        texto:
          'Multicentro Las Américas, módulo 14 del segundo piso · Caja principal del mostrador',
      },
      { tipo: 'texto', texto: 'Abrió: María de los Ángeles Gutiérrez Sandoval (07/10/2026 08:05)' },
      { tipo: 'texto', texto: referencia },
      { tipo: 'linea' },
      { tipo: 'par', izquierda: 'Turno 1234567', derecha: '07/10/2026 21:35' },
      {
        tipo: 'par',
        izquierda: '12 x Perforación Hélix doble con pieza de titanio — Con pieza incluida',
        derecha: '1,234,567.89',
      },
      { tipo: 'par', izquierda: 'TOTAL C$', derecha: '98,765,432.10', negrita: true },
      {
        tipo: 'par',
        izquierda: 'Transferencia bancaria',
        derecha: 'recibida el miércoles 07/10/2026 a las 21:35, hora de Managua',
      },
      { tipo: 'qr', contenido: 'LAM-00000012' },
      { tipo: 'texto', texto: 'LAM-00000012', centrado: true },
    ];
    const p = await pagina(renglones);

    expect(p.ancho).toBeCloseTo(ANCHO, 2);
    expect(loQueSeSale(p)).toEqual([]); // ni un texto ni un trazo fuera de los 72 mm
    expect(loQueSeSale(p, { desde: MARGEN, hasta: ANCHO - MARGEN })).toEqual([]); // ni en el margen
    for (const texto of p.textos) expect(texto.derecha - texto.izquierda).toBeLessThanOrEqual(68);

    // Lo largo se partió en más renglones, sin perder nada: la palabra sola sigue entera
    expect(p.textos.length).toBeGreaterThan(renglones.length);
    const todo = escrito(p);
    const dondeEmpieza = todo.findIndex((t) => t.startsWith('REF-'));
    const pedazos = todo.slice(dondeEmpieza, dondeEmpieza + 2);
    expect(pedazos.join('')).toBe(referencia);
    expect(todo.join(' ')).toContain('Multicentro Las Américas, módulo 14 del segundo piso · Caja');
    expect(todo).toEqual(expect.arrayContaining(['1,234,567.89', '98,765,432.10', 'TOTAL C$']));
    // la línea punteada y el QR también se leyeron
    expect(p.trazos.length).toBeGreaterThan(20);
  });

  it('el monto de la derecha sale completo, termina en el margen y no se encima', async () => {
    for (const negrita of [false, true]) {
      for (const monto of ['0.50', '1,250.00', '-111.00', '1,234,567.89']) {
        const p = await pagina([
          { tipo: 'par', izquierda: 'Fondo que queda C$', derecha: monto, negrita },
        ]);
        const [etiqueta, valor] = p.textos;
        expect([etiqueta.texto, valor.texto]).toEqual(['Fondo que queda C$', monto]);
        expect(valor.fuente).toBe(negrita ? 'Helvetica-Bold' : 'Helvetica');
        expect(valor.derecha).toBeCloseTo(ANCHO - MARGEN, 2);
        expect(valor.y).toBeCloseTo(etiqueta.y, 5); // en el mismo renglón
        expect(etiqueta.derecha).toBeLessThan(valor.izquierda);
      }
    }
  });

  it('lo de la izquierda, si es largo, se parte en su columna y deja libre la del monto', async () => {
    const p = await pagina([
      {
        tipo: 'par',
        izquierda: '1 x Perforación Lóbulo con pieza de acero quirúrgico — Con pieza incluida',
        derecha: '650.00',
      },
    ]);
    const monto = p.textos.find((t) => t.texto === '650.00')!;
    const nombre = p.textos.filter((t) => t !== monto);
    expect(nombre.length).toBeGreaterThan(1);
    expect(nombre.map((t) => t.texto).join(' ')).toBe(
      '1 x Perforación Lóbulo con pieza de acero quirúrgico — Con pieza incluida',
    );
    expect(monto.y).toBeCloseTo(nombre[0].y, 5); // el monto, a la altura del primer renglón
    expect(monto.derecha).toBeCloseTo(ANCHO - MARGEN, 2);
    for (const pedazo of nombre) expect(pedazo.derecha).toBeLessThan(monto.izquierda);
  });

  it('si lo de la derecha no deja sitio, baja a su propio renglón en lugar de cortarse', async () => {
    const p = await pagina([
      {
        tipo: 'par',
        izquierda: 'Multicentro Las Américas · Caja principal',
        derecha: 'miércoles 07/10/2026 21:35 (Managua)',
      },
      { tipo: 'par', izquierda: 'Turno 7', derecha: '07/10/2026 21:35' },
    ]);
    const [sucursal, fecha, turno, hora] = p.textos;
    expect(escrito(p)).toEqual([
      'Multicentro Las Américas · Caja principal',
      'miércoles 07/10/2026 21:35 (Managua)',
      'Turno 7',
      '07/10/2026 21:35',
    ]);
    expect(fecha.y).toBeGreaterThan(sucursal.y + 2); // un renglón más abajo
    expect(fecha.derecha).toBeCloseTo(ANCHO - MARGEN, 2);
    // lo corto sigue lado a lado, y empieza después de lo anterior
    expect(hora.y).toBeCloseTo(turno.y, 5);
    expect(turno.y).toBeGreaterThan(fecha.y + 2);
    expect(loQueSeSale(p, { desde: MARGEN, hasta: ANCHO - MARGEN })).toEqual([]);
  });

  it('la página es tan alta como su contenido, sin papel en blanco al final', async () => {
    const renglones = (cuantos: number): Renglon[] =>
      Array.from({ length: cuantos }, (_, i) => ({
        tipo: 'par' as const,
        izquierda: `Artículo ${i + 1}`,
        derecha: '100.00',
      }));
    const mediana = await pagina(renglones(40));
    const larga = await pagina(renglones(120));
    for (const p of [mediana, larga]) {
      const ultimo = Math.max(...p.textos.map((t) => t.y));
      // debajo del último renglón solo queda el margen
      expect(p.alto - ultimo).toBeGreaterThan(MARGEN);
      expect(p.alto - ultimo).toBeLessThan(MARGEN + 2.5);
    }
    // cada renglón alarga la página lo mismo, tenga los que tenga
    const porRenglon = (larga.alto - mediana.alto) / 80;
    expect(porRenglon).toBeGreaterThan(3);
    expect(mediana.alto).toBeCloseTo(40 * porRenglon + 2 * MARGEN, 0);
  });

  it('nunca queda más ancha que alta (Chrome la imprimiría girada)', async () => {
    const corto = await pagina([
      { tipo: 'texto', texto: 'CIERRE FORZADO (sin conteo)', centrado: true, negrita: true },
      { tipo: 'par', izquierda: 'Turno 8', derecha: '08/10/2026 09:00' },
    ]);
    expect(corto.alto).toBeGreaterThan(corto.ancho);
    expect(corto.alto).toBeCloseTo(ANCHO + 1, 1);
    const vacio = await pagina([]);
    expect(vacio.alto).toBeGreaterThan(vacio.ancho);
  });

  it('la lectura del PDF sí encuentra lo que se sale (como el ticket viejo de 80 mm)', async () => {
    // Como estaba antes: página de 80 mm y el monto terminando a 76 mm del borde
    const mm = (valor: number) => valor / MM_POR_PUNTO;
    const viejo = new PDFDocument({ size: [mm(80), mm(90)], margin: 0 });
    viejo.font('Helvetica').fontSize(8);
    viejo.text('Fondo que queda C$', mm(4), mm(4), { lineBreak: false });
    viejo.text('1,000.00', mm(76) - viejo.widthOfString('1,000.00'), mm(4), { lineBreak: false });
    viejo.moveTo(mm(4), mm(10)).lineTo(mm(76), mm(10)).stroke();
    const p = leerPdf(await aBuffer(viejo));

    expect(p.ancho).toBeCloseTo(80, 2);
    expect(escrito(p)).toEqual(['Fondo que queda C$', '1,000.00']);
    expect(p.textos[1].derecha).toBeCloseTo(76, 2);
    expect(loQueSeSale(p)).toEqual([
      expect.stringMatching(/^«1,000\.00» va de \d+\.\d+ a 76\.00 mm$/),
      'un trazo va de 76.00 a 76.00 mm',
    ]);
  });

  it('es una sola página y pide imprimirse a tamaño real', async () => {
    const pdf = (
      await ticketPdf([{ tipo: 'par', izquierda: 'TOTAL C$', derecha: '999.00' }], 'Ticket')
    ).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(pdf).toMatch(/\/ViewerPreferences \d+ 0 R/);
    expect(pdf).toMatch(/\/PrintScaling \/None/);
  });
});
