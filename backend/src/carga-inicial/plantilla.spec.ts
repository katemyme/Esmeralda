import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leerPlantilla, normalizar } from './plantilla';

const RUTA_PLANTILLA = join(__dirname, '..', '..', '..', 'docs', 'plantilla-carga-inicial.xlsx');

describe('normalizar', () => {
  it('compara nombres sin importar mayúsculas, tildes ni espacios de más', () => {
    expect(normalizar('  ACERO   Clásica ')).toBe('acero clasica');
    expect(normalizar('Multicentro Las Américas')).toBe('multicentro las americas');
  });
});

describe('leerPlantilla', () => {
  it('lee la plantilla tal como se entrega: las categorías y la fila de ejemplo de cada hoja', async () => {
    const plantilla = await leerPlantilla(readFileSync(RUTA_PLANTILLA));
    expect(plantilla.categorias.map((c) => c.datos.nombre)).toEqual([
      'Perforaciones',
      'Piercing titanio',
      'Piercing acero',
      'Piercing bioflex',
      'Cuidado posterior',
      'Joyería plata 925',
      'Joyería xuping',
      'Joyería estilo Dubái',
      'Accesorios dama',
      'Accesorios caballero',
      'Perfumería',
    ]);
    expect(plantilla.perforaciones).toEqual([
      {
        fila: 2,
        datos: {
          codigo: 'HLX',
          nombre: 'Hélix',
          precio_servicio: 350,
          piezas: 1,
          acepta: { 'Acero clásica': true, 'Acero de lujo': true, Titanio: true },
          precios: { 'ACERO CLÁSICA': 450, 'ACERO DE LUJO': 550 },
          notas: 'Ejemplo: hélix',
        },
      },
    ]);
    expect(plantilla.productos).toEqual([
      {
        fila: 2,
        datos: {
          sku: 'TIT-LAB-16-6',
          codigo_barras: null,
          categoria: 'Piercing titanio',
          producto: 'Labret rosca interna',
          variante: 'Titanio F-136 · 16G · 6 mm',
          material: 'Titanio ASTM F-136',
          calibre: '16G',
          medida_mm: 6,
          gama: 'Titanio',
          precio: 650,
          costo: 220,
          minimos: { 'Las Américas': 5, 'Las Brisas': 5 },
          notas: 'Ejemplo',
        },
      },
    ]);
    expect(plantilla.inventario).toEqual([
      {
        fila: 2,
        datos: {
          sku: 'TIT-LAB-16-6',
          cantidades: { 'Bodega central': 10, 'Las Américas': 20, 'Las Brisas': 10 },
        },
      },
    ]);
    expect(plantilla.preciosEspeciales[0].datos).toMatchObject({
      perforacion: 'HLX',
      sku: 'TIT-LAB-16-8',
      gama: '',
      precio: 900,
    });
    expect(plantilla.usuarios[0].datos).toMatchObject({
      nombre: 'María López',
      username: 'maria.lopez',
      rol: 'Encargado',
      sucursal: 'Las Américas',
    });
    expect(plantilla.promociones[0].datos).toMatchObject({
      nombre: 'Promo 10 %',
      tipo: 'PORCENTAJE',
      valor: 10,
      activa: 'No',
    });
    expect(plantilla.proveedores).toHaveLength(1);
  });

  it('rechaza lo que no es la plantilla', async () => {
    const mensaje = async (contenido: Buffer) => {
      const error = await leerPlantilla(contenido).catch((e: unknown) => e);
      return (error as { getResponse(): { codigo: string; mensaje: string } }).getResponse();
    };
    expect(await mensaje(Buffer.from('nombre,precio\nAro,100'))).toEqual({
      codigo: 'ARCHIVO_INVALIDO',
      mensaje: 'El archivo no es un libro de Excel (.xlsx)',
    });
    expect(await mensaje(Buffer.from('PK esto no es un zip de verdad'))).toEqual({
      codigo: 'ARCHIVO_INVALIDO',
      mensaje: 'No se pudo leer el archivo: guárdelo como libro de Excel (.xlsx)',
    });
    const otroLibro = new ExcelJS.Workbook();
    otroLibro.addWorksheet('Hoja1').addRow(['algo']);
    otroLibro.addWorksheet('Productos');
    const respuesta = await mensaje(Buffer.from(await otroLibro.xlsx.writeBuffer()));
    expect(respuesta.codigo).toBe('ARCHIVO_INVALIDO');
    expect(respuesta.mensaje).toMatch(
      /^El archivo no es la plantilla de carga inicial: faltan las hojas Categorias, Perforaciones, PreciosPaquete,/,
    );
  });
});
