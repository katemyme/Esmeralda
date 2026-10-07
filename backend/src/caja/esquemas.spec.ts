import type { z } from 'zod';
import { esquemaTipoCambio } from '../tipo-cambio/esquemas';
import {
  esquemaAbrirTurno,
  esquemaCajaElegida,
  esquemaCerrarTurno,
  esquemaCierreForzado,
  esquemaFiltroTurnos,
  esquemaMovimientoCaja,
} from './esquemas';

function mensajes(esquema: z.ZodType, datos: unknown): Record<string, string> {
  const resultado = esquema.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );
}

describe('esquemaAbrirTurno', () => {
  it('sin datos abre con la gaveta en cero; la caja no se indica (sale del equipo)', () => {
    expect(esquemaAbrirTurno.parse({})).toEqual({ inicial_nio: '0', inicial_usd: '0' });
    expect(
      esquemaAbrirTurno.parse({ inicial_nio: 1000, inicial_usd: '20.50', sucursal_id: 2 }),
    ).toEqual({ inicial_nio: '1000', inicial_usd: '20.50' });
    expect(esquemaAbrirTurno.parse({ caja_id: 3 })).toMatchObject({ caja_id: 3 });
  });

  it('mensajes por campo', () => {
    expect(mensajes(esquemaAbrirTurno, { inicial_nio: -1, inicial_usd: '1.005' })).toEqual({
      inicial_nio:
        'El efectivo inicial en córdobas debe ser un monto de 0 en adelante, con 2 decimales como máximo',
      inicial_usd:
        'El efectivo inicial en dólares debe ser un monto de 0 en adelante, con 2 decimales como máximo',
    });
  });
});

describe('esquemaMovimientoCaja', () => {
  it('normaliza el tipo y la moneda (córdobas por defecto)', () => {
    expect(
      esquemaMovimientoCaja.parse({ tipo: ' egreso ', monto: 200, motivo: ' Agua y papel ' }),
    ).toEqual({ tipo: 'EGRESO', moneda: 'NIO', monto: '200', motivo: 'Agua y papel' });
    expect(
      esquemaMovimientoCaja.parse({
        tipo: 'INGRESO',
        moneda: 'usd',
        monto: '5.5',
        motivo: 'Sencillo',
      }),
    ).toMatchObject({ tipo: 'INGRESO', moneda: 'USD', monto: '5.5' });
  });

  it('mensajes por campo', () => {
    expect(mensajes(esquemaMovimientoCaja, {})).toEqual({
      tipo: 'Indique el tipo: INGRESO o EGRESO',
      monto: 'El monto debe ser mayor que 0, con 2 decimales como máximo',
      motivo: 'Explique el motivo del movimiento',
    });
    expect(
      mensajes(esquemaMovimientoCaja, { tipo: 'RETIRO', moneda: 'EUR', monto: 0, motivo: 'pan' }),
    ).toEqual({
      tipo: 'El tipo debe ser INGRESO o EGRESO',
      moneda: 'La moneda debe ser NIO o USD',
      monto: 'El monto debe ser mayor que 0, con 2 decimales como máximo',
      motivo: 'El motivo debe tener al menos 5 caracteres',
    });
  });
});

describe('esquemaCerrarTurno', () => {
  it('un cierre vacío es un conteo en cero, sin retiro', () => {
    expect(esquemaCerrarTurno.parse({})).toEqual({
      efectivo: [],
      no_efectivo: [],
      retiro_nio: '0',
      retiro_usd: '0',
      justificacion: null,
      observaciones: null,
    });
  });

  it('normaliza el conteo; quien cierra no puede enviar montos esperados ni diferencias', () => {
    const datos = esquemaCerrarTurno.parse({
      efectivo: [
        { moneda: 'nio', valor: '1000.00', cantidad: 3 },
        { moneda: 'USD', valor: 0.25, cantidad: 0, tipo: 'MONEDA' },
      ],
      no_efectivo: [{ metodo: ' tarjeta ', monto: 3100.5, monto_esperado: 3100.5 }],
      retiro_nio: 2500,
      justificacion: '  ',
      observaciones: ' Todo en orden ',
      monto_esperado: 5000,
      diferencia: 0,
      turno_id: 9,
    });
    expect(datos).toEqual({
      efectivo: [
        { moneda: 'NIO', valor: 1000, cantidad: 3 },
        { moneda: 'USD', valor: 0.25, cantidad: 0 },
      ],
      no_efectivo: [{ metodo: 'TARJETA', monto: '3100.5' }],
      retiro_nio: '2500',
      retiro_usd: '0',
      justificacion: null,
      observaciones: 'Todo en orden',
    });
  });

  it('mensajes por campo', () => {
    expect(
      mensajes(esquemaCerrarTurno, {
        efectivo: [{ moneda: 'EUR', valor: 'mil', cantidad: 1.5 }],
        no_efectivo: [{ metodo: 'tarjeta de crédito', monto: -1 }],
        retiro_usd: '1,50',
        justificacion: 'x'.repeat(501),
      }),
    ).toEqual({
      'efectivo.0.moneda': 'La moneda debe ser NIO o USD',
      'efectivo.0.valor': 'Indique el valor del billete o la moneda (mayor que 0)',
      'efectivo.0.cantidad': 'La cantidad debe ser un entero de 0 en adelante',
      'no_efectivo.0.metodo': 'El método de pago no es válido',
      'no_efectivo.0.monto': 'El monto debe ser de 0 en adelante, con 2 decimales como máximo',
      retiro_usd:
        'El retiro en dólares debe ser un monto de 0 en adelante, con 2 decimales como máximo',
      justificacion: 'La justificación es demasiado larga',
    });
    expect(mensajes(esquemaCerrarTurno, { efectivo: 'mucho', no_efectivo: 5 })).toEqual({
      efectivo: 'Envíe el conteo en "efectivo": [{ moneda, valor, cantidad }]',
      no_efectivo: 'Envíe los vouchers y transferencias en "no_efectivo": [{ metodo, monto }]',
    });
  });
});

describe('otros esquemas de la caja', () => {
  it('caja elegida en la consulta, motivo del cierre forzado y filtros de turnos', () => {
    expect(esquemaCajaElegida.parse({})).toEqual({});
    expect(esquemaCajaElegida.parse({ caja_id: '3' })).toEqual({ caja_id: 3 });
    expect(mensajes(esquemaCajaElegida, { caja_id: 'principal' })).toEqual({
      caja_id: 'caja_id debe ser el id de una caja',
    });

    expect(esquemaCierreForzado.parse({ motivo: ' Nadie cerró anoche ' })).toEqual({
      motivo: 'Nadie cerró anoche',
    });
    expect(mensajes(esquemaCierreForzado, { motivo: 'Nadie' })).toEqual({
      motivo: 'El motivo debe tener al menos 10 caracteres',
    });
    expect(mensajes(esquemaCierreForzado, {})).toEqual({
      motivo: 'Explique por qué se cierra el turno sin arqueo',
    });

    expect(esquemaFiltroTurnos.parse({})).toEqual({ limite: 50 });
    expect(
      esquemaFiltroTurnos.parse({ sucursal_id: '2', estado: 'abierto', desde: '2026-10-01' }),
    ).toEqual({ sucursal_id: 2, estado: 'ABIERTO', desde: '2026-10-01', limite: 50 });
    expect(mensajes(esquemaFiltroTurnos, { estado: 'pendiente', hasta: 'hoy' })).toEqual({
      estado: 'estado debe ser ABIERTO o CERRADO',
      hasta: 'hasta debe ser una fecha con el formato AAAA-MM-DD',
    });
  });
});

describe('esquemaTipoCambio', () => {
  const MENSAJE = 'usd_a_nio debe ser un monto mayor que 0, con 4 decimales como máximo';

  it('córdobas por dólar, con hasta 4 decimales; sin confirmar si no se dice', () => {
    expect(esquemaTipoCambio.parse({ usd_a_nio: 36.6243 })).toEqual({
      usd_a_nio: '36.6243',
      confirmar: false,
    });
    expect(esquemaTipoCambio.parse({ usd_a_nio: ' 36.8 ', confirmar: true })).toEqual({
      usd_a_nio: '36.8',
      confirmar: true,
    });
  });

  it('un solo mensaje para cualquier valor inválido', () => {
    for (const usd_a_nio of [0, '0.0000', -36, 36.62435, 'treinta', null, undefined]) {
      const resultado = esquemaTipoCambio.safeParse({ usd_a_nio });
      expect(resultado.error?.issues.map((i) => i.message)).toEqual([MENSAJE]);
    }
  });

  it('la confirmación solo vale como true o false', () => {
    for (const confirmar of ['true', 'si', 1, null]) {
      const resultado = esquemaTipoCambio.safeParse({ usd_a_nio: 36.6243, confirmar });
      expect(resultado.error?.issues.map((i) => i.message)).toEqual([
        'confirmar debe ser true o false',
      ]);
    }
  });
});
