import type { z } from 'zod';
import {
  esquemaActualizarVariante,
  esquemaCrearProducto,
  esquemaCrearVariante,
  esquemaFiltroProductos,
  esquemaPrecioVariante,
} from './esquemas';

function mensajes(esquema: z.ZodType, datos: unknown): Record<string, string> {
  const resultado = esquema.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );
}

describe('esquemaCrearVariante', () => {
  it('lo mínimo: SKU y precio; lo demás toma su valor por defecto', () => {
    expect(esquemaCrearVariante.parse({ sku: ' rel-01 ', precio_venta: 900 })).toEqual({
      sku: 'REL-01',
      nombre: null,
      precio_venta: '900',
      costo: '0',
      codigo_barras: null,
      gama_id: null,
      atributos: {},
      foto_url: null,
    });
  });

  it('acepta una variante completa', () => {
    expect(
      esquemaCrearVariante.parse({
        sku: 'TIT-LAB-16-10',
        nombre: ' Titanio · 16G · 10 mm ',
        precio_venta: '650.50',
        costo: 220,
        codigo_barras: ' 7501000000066 ',
        gama_id: 3,
        atributos: { material: 'titanio', largo_mm: 10, esteril: true },
        foto_url: 'https://ejemplo.com/labret.jpg',
      }),
    ).toEqual({
      sku: 'TIT-LAB-16-10',
      nombre: 'Titanio · 16G · 10 mm',
      precio_venta: '650.50',
      costo: '220',
      codigo_barras: '7501000000066',
      gama_id: 3,
      atributos: { material: 'titanio', largo_mm: 10, esteril: true },
      foto_url: 'https://ejemplo.com/labret.jpg',
    });
  });

  it('mensajes en español por campo', () => {
    expect(mensajes(esquemaCrearVariante, {})).toEqual({
      sku: 'Escriba el SKU',
      precio_venta: 'El precio debe ser un monto de 0 en adelante, con 2 decimales como máximo',
    });
    expect(
      mensajes(esquemaCrearVariante, {
        sku: 'REL 01',
        precio_venta: -5,
        costo: 1.999,
        codigo_barras: '750 100',
        gama_id: 'titanio',
        atributos: ['titanio'],
        foto_url: 'javascript:alert(1)',
      }),
    ).toEqual({
      sku: 'El SKU debe tener de 1 a 40 caracteres, sin espacios',
      precio_venta: 'El precio debe ser un monto de 0 en adelante, con 2 decimales como máximo',
      costo: 'El costo debe ser un monto de 0 en adelante, con 2 decimales como máximo',
      codigo_barras: 'El código de barras no lleva espacios',
      gama_id: 'La gama se indica con su id (o null si la pieza no tiene gama)',
      atributos:
        'Los atributos van como un objeto de hasta 20 datos, p. ej. { "material": "titanio", "calibre": "16G" }',
      foto_url: 'La foto debe ser una imagen subida al sistema o una dirección web (http o https)',
    });
  });

  it('los atributos solo llevan textos, números o sí/no', () => {
    expect(
      esquemaCrearVariante.safeParse({
        sku: 'X-1',
        precio_venta: 1,
        atributos: { medidas: { largo: 8 } },
      }).success,
    ).toBe(false);
  });
});

describe('esquemaActualizarVariante', () => {
  it('exige la gama (aunque sea null) y los atributos: no se borran por omisión', () => {
    expect(mensajes(esquemaActualizarVariante, { sku: 'REL-01' })).toEqual({
      gama_id: 'La gama se indica con su id (o null si la pieza no tiene gama)',
      atributos:
        'Los atributos van como un objeto de hasta 20 datos, p. ej. { "material": "titanio", "calibre": "16G" }',
    });
    expect(
      esquemaActualizarVariante.parse({ sku: 'rel-01', gama_id: null, atributos: {} }),
    ).toEqual({
      sku: 'REL-01',
      nombre: null,
      codigo_barras: null,
      gama_id: null,
      atributos: {},
      foto_url: null,
    });
  });

  it('no acepta precio ni costo (van por /precio)', () => {
    const datos = esquemaActualizarVariante.parse({
      sku: 'REL-01',
      gama_id: 2,
      atributos: {},
      precio_venta: 1,
      costo: 1,
    });
    expect(datos).not.toHaveProperty('precio_venta');
    expect(datos).not.toHaveProperty('costo');
  });
});

describe('esquemaPrecioVariante', () => {
  it('acepta precio, costo o ambos', () => {
    expect(esquemaPrecioVariante.parse({ precio_venta: 950.5 })).toEqual({ precio_venta: '950.5' });
    expect(esquemaPrecioVariante.parse({ costo: '380' })).toEqual({ costo: '380' });
    expect(esquemaPrecioVariante.parse({ precio_venta: 1, costo: 0 })).toEqual({
      precio_venta: '1',
      costo: '0',
    });
  });

  it('exige al menos uno', () => {
    expect(mensajes(esquemaPrecioVariante, {})).toEqual({
      precio_venta: 'Envíe precio_venta, costo o ambos',
    });
  });
});

describe('esquemaCrearProducto', () => {
  it('las variantes son opcionales y cada una se valida', () => {
    expect(esquemaCrearProducto.parse({ categoria_id: 4, nombre: ' Reloj clásico ' })).toEqual({
      categoria_id: 4,
      nombre: 'Reloj clásico',
      descripcion: null,
      variantes: [],
    });
    expect(
      mensajes(esquemaCrearProducto, {
        nombre: 'R',
        variantes: [{ sku: 'REL-01', precio_venta: 900 }, { sku: 'REL-02' }],
      }),
    ).toEqual({
      categoria_id: 'Indique la categoría del producto',
      nombre: 'El nombre del producto debe tener al menos 2 caracteres',
      'variantes.1.precio_venta':
        'El precio debe ser un monto de 0 en adelante, con 2 decimales como máximo',
    });
  });
});

describe('esquemaFiltroProductos', () => {
  it('sin filtros: los primeros 50 productos activos', () => {
    expect(esquemaFiltroProductos.parse({})).toEqual({
      estado: 'activos',
      limite: 50,
      desplazamiento: 0,
    });
  });

  it('convierte los números que llegan como texto y normaliza el tipo', () => {
    expect(
      esquemaFiltroProductos.parse({
        buscar: '  labret ',
        categoria_id: '3',
        tipo: 'servicio',
        estado: 'todos',
        limite: '20',
        desplazamiento: '40',
      }),
    ).toEqual({
      buscar: 'labret',
      categoria_id: 3,
      tipo: 'SERVICIO',
      estado: 'todos',
      limite: 20,
      desplazamiento: 40,
    });
    expect(esquemaFiltroProductos.parse({ buscar: '   ' }).buscar).toBeUndefined();
  });

  it('rechaza valores inválidos', () => {
    expect(
      mensajes(esquemaFiltroProductos, {
        categoria_id: 'anillos',
        tipo: 'combo',
        estado: 'borrados',
        limite: '0',
        desplazamiento: '-1',
      }),
    ).toEqual({
      categoria_id: 'categoria_id debe ser el id de una categoría',
      tipo: 'tipo debe ser PRODUCTO, SERVICIO o PAQUETE',
      estado: 'estado debe ser activos, inactivos o todos',
      limite: 'limite debe ser un número entre 1 y 200',
      desplazamiento: 'desplazamiento debe ser un número de 0 en adelante',
    });
  });
});
