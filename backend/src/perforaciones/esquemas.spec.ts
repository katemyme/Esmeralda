import type { z } from 'zod';
import {
  esquemaCrearPerforacion,
  esquemaPiezaPermitida,
  esquemaPiezasPaquete,
  esquemaPrecioEspecial,
  esquemaPrecioGama,
} from './esquemas';

function mensajes(esquema: z.ZodType, datos: unknown): Record<string, string> {
  const resultado = esquema.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );
}

describe('esquemaCrearPerforacion', () => {
  it('normaliza el código y por defecto el paquete lleva 1 pieza', () => {
    expect(
      esquemaCrearPerforacion.parse({ codigo: ' nar ', nombre: ' Nariz ', precio_servicio: 250 }),
    ).toEqual({ codigo: 'NAR', nombre: 'Nariz', precio_servicio: '250', piezas_por_paquete: 1 });
  });

  it('mensajes en español por campo', () => {
    expect(
      mensajes(esquemaCrearPerforacion, {
        codigo: 'N4',
        nombre: 'N',
        precio_servicio: -1,
        piezas_por_paquete: 5,
      }),
    ).toEqual({
      codigo: 'El código debe tener de 2 a 6 letras, sin tildes ni números',
      nombre: 'El nombre de la perforación debe tener al menos 2 caracteres',
      precio_servicio:
        'El precio de solo servicio debe ser un monto de 0 en adelante, con 2 decimales como máximo',
      piezas_por_paquete: 'El paquete lleva de 1 a 4 piezas',
    });
  });
});

describe('precios del paquete', () => {
  it('tabla por gama: precio mayor que 0, o null para quitarlo', () => {
    expect(esquemaPrecioGama.parse({ gama_id: 1, precio: 450 })).toEqual({
      gama_id: 1,
      precio: '450',
    });
    expect(esquemaPrecioGama.parse({ gama_id: 1, precio: null })).toEqual({
      gama_id: 1,
      precio: null,
    });
    expect(mensajes(esquemaPrecioGama, { precio: 0 })).toEqual({
      gama_id: 'Indique la gama (gama_id)',
      precio:
        'El precio debe ser un monto mayor que 0, con 2 decimales como máximo (o null para quitarlo)',
    });
  });

  it('precio especial: para una pieza o para una gama, nunca las dos ni ninguna', () => {
    expect(
      esquemaPrecioEspecial.parse({ variante_id: 8, precio: '900', motivo: ' Lanzamiento ' }),
    ).toEqual({ variante_id: 8, gama_id: null, precio: '900', motivo: 'Lanzamiento' });
    expect(esquemaPrecioEspecial.parse({ gama_id: 2, precio: null })).toEqual({
      variante_id: null,
      gama_id: 2,
      precio: null,
      motivo: null,
    });
    const mensaje = 'Indique una pieza (variante_id) o una gama (gama_id), no las dos';
    expect(mensajes(esquemaPrecioEspecial, { precio: 900 })).toEqual({ variante_id: mensaje });
    expect(mensajes(esquemaPrecioEspecial, { variante_id: 8, gama_id: 2, precio: 900 })).toEqual({
      variante_id: mensaje,
    });
  });
});

describe('esquemaPiezaPermitida', () => {
  it('exactamente una regla: gama, categoría o pieza', () => {
    expect(esquemaPiezaPermitida.parse({ categoria_id: 3, permitir: true })).toEqual({
      gama_id: null,
      categoria_id: 3,
      variante_id: null,
      permitir: true,
    });
    const mensaje = 'Indique exactamente una: gama_id, categoria_id o variante_id';
    expect(mensajes(esquemaPiezaPermitida, { permitir: true })).toEqual({ gama_id: mensaje });
    expect(
      mensajes(esquemaPiezaPermitida, { gama_id: 1, variante_id: 2, permitir: false }),
    ).toEqual({ gama_id: mensaje });
    expect(mensajes(esquemaPiezaPermitida, { gama_id: 1 })).toEqual({
      permitir: 'Indique "permitir": true para agregar la regla, false para quitarla',
    });
  });
});

describe('esquemaPiezasPaquete', () => {
  it('convierte ?piezas=12,15 en la lista de ids (la misma pieza puede ir dos veces)', () => {
    expect(esquemaPiezasPaquete.parse({ piezas: '12' })).toEqual({ piezas: [12] });
    expect(esquemaPiezasPaquete.parse({ piezas: '12,15,12' })).toEqual({ piezas: [12, 15, 12] });
  });

  it('rechaza listas vacías, con más de 4 piezas o con algo que no sea un id', () => {
    for (const malo of [
      {},
      { piezas: '' },
      { piezas: '1,2,3,4,5' },
      { piezas: '1;2' },
      { piezas: 'a' },
    ]) {
      expect(esquemaPiezasPaquete.safeParse(malo).success).toBe(false);
    }
  });
});
