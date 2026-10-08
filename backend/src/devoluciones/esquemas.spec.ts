import type { z } from 'zod';
import {
  esquemaBuscarVenta,
  esquemaEjecutarDevolucion,
  esquemaFiltroDevoluciones,
  esquemaResolverDevolucion,
  esquemaSolicitarDevolucion,
  esquemaTransferencia,
} from './esquemas';

const CLAVE = '6f1c0f6e-3b1a-4a3e-9d55-0c4b8f0f1a11';

function mensajes(esquema: z.ZodType, datos: unknown): Record<string, string> {
  const resultado = esquema.safeParse(datos);
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
  );
}

describe('esquemaBuscarVenta', () => {
  it('acepta el número como sale en el QR y también escrito a mano', () => {
    expect(esquemaBuscarVenta.parse({ numero: 'LAM-00000012' })).toEqual({
      numero: 'LAM-00000012',
    });
    expect(esquemaBuscarVenta.parse({ numero: ' lam-12 ' })).toEqual({ numero: 'LAM-00000012' });
  });

  it('lo que no es un número de factura → mensaje', () => {
    const mensaje = 'El número de factura no es válido (ejemplo: LAM-00000012)';
    for (const numero of ['12', 'LAM', 'LAM-', 'LAM 12', 'DEV-LAM-000001', 'LAM-123456789']) {
      expect(mensajes(esquemaBuscarVenta, { numero })).toEqual({ numero: mensaje });
    }
    expect(mensajes(esquemaBuscarVenta, {})).toEqual({
      numero: 'Indique el número de factura (numero)',
    });
  });
});

describe('esquemaSolicitarDevolucion', () => {
  const solicitud = {
    venta_id: 31,
    tipo: 'devolucion',
    motivo: '  No le gustó el aroma ',
    cliente_nombre: ' Carla Cliente ',
    cliente_telefono: ' 8888-1234 ',
    lineas: [{ detalle_id: 815, cantidad: 1, estado: 'bueno' }],
  };

  it('normaliza el tipo, el estado y los textos; no lleva sucursal ni monto', () => {
    const datos = esquemaSolicitarDevolucion.parse({
      ...solicitud,
      monto_total: 5000,
      estado: 'APROBADA',
      lineas: [{ ...solicitud.lineas[0], monto: 5000 }],
    });
    expect(datos).toEqual({
      venta_id: 31,
      tipo: 'DEVOLUCION',
      motivo: 'No le gustó el aroma',
      cliente_nombre: 'Carla Cliente',
      cliente_telefono: '8888-1234',
      lineas: [{ detalle_id: 815, cantidad: 1, estado: 'BUENO' }],
    });
  });

  it('una línea puede ir en parte buena y en parte defectuosa; sucursal_id solo lo usa el admin', () => {
    const datos = esquemaSolicitarDevolucion.parse({
      ...solicitud,
      tipo: 'CAMBIO',
      sucursal_id: 2,
      lineas: [
        { detalle_id: 815, cantidad: 2, estado: 'BUENO' },
        { detalle_id: 815, cantidad: 1, estado: 'Defectuoso' },
      ],
    });
    expect(datos.tipo).toBe('CAMBIO');
    expect(datos.sucursal_id).toBe(2);
    expect(datos.lineas.map((l) => l.estado)).toEqual(['BUENO', 'DEFECTUOSO']);
  });

  it('exige el motivo, el nombre y el teléfono del cliente, y al menos un producto', () => {
    expect(
      mensajes(esquemaSolicitarDevolucion, {
        venta_id: 31,
        tipo: 'REGALO',
        motivo: 'no',
        cliente_nombre: ' ',
        cliente_telefono: '123',
        lineas: [],
      }),
    ).toEqual({
      tipo: 'tipo debe ser DEVOLUCION o CAMBIO',
      motivo: 'El motivo debe tener al menos 5 caracteres',
      cliente_nombre: 'Escriba el nombre del cliente',
      cliente_telefono: 'Escriba el teléfono del cliente (al menos 7 caracteres)',
      lineas: 'Indique al menos un producto para devolver',
    });
    expect(mensajes(esquemaSolicitarDevolucion, {})).toEqual({
      venta_id: 'Indique la venta (venta_id)',
      tipo: 'Indique si es una devolución o un cambio (tipo)',
      motivo: 'Escriba el motivo de la devolución',
      cliente_nombre: 'Escriba el nombre del cliente',
      cliente_telefono: 'Escriba el teléfono del cliente',
      lineas: 'Envíe lo que se devuelve en "lineas": [{ detalle_id, cantidad, estado }]',
    });
  });

  it('cada línea: la de la factura, una cantidad entera de 1 en adelante y su estado', () => {
    expect(
      mensajes(esquemaSolicitarDevolucion, {
        ...solicitud,
        lineas: [{ detalle_id: 0, cantidad: 0, estado: 'USADO' }, { cantidad: 1.5 }],
      }),
    ).toEqual({
      'lineas.0.detalle_id': 'Indique la línea de la factura (detalle_id)',
      'lineas.0.cantidad': 'La cantidad debe ser un entero de 1 en adelante',
      'lineas.0.estado': 'Indique el estado del producto: BUENO o DEFECTUOSO',
      'lineas.1.detalle_id': 'Indique la línea de la factura (detalle_id)',
      'lineas.1.cantidad': 'La cantidad debe ser un entero de 1 en adelante',
      'lineas.1.estado': 'Indique el estado del producto: BUENO o DEFECTUOSO',
    });
  });
});

describe('esquemaResolverDevolucion', () => {
  it('aprobar no pide comentario; rechazar sí', () => {
    expect(esquemaResolverDevolucion.parse({ aprobar: true })).toEqual({
      aprobar: true,
      comentario: null,
    });
    expect(esquemaResolverDevolucion.parse({ aprobar: true, comentario: ' Proceda ' })).toEqual({
      aprobar: true,
      comentario: 'Proceda',
    });
    expect(esquemaResolverDevolucion.parse({ aprobar: false, comentario: 'Viene usado' })).toEqual({
      aprobar: false,
      comentario: 'Viene usado',
    });
    for (const comentario of [undefined, null, '', '  no '] as const) {
      expect(mensajes(esquemaResolverDevolucion, { aprobar: false, comentario })).toEqual({
        comentario: 'Para rechazar la devolución escriba el motivo (al menos 5 caracteres)',
      });
    }
    expect(mensajes(esquemaResolverDevolucion, { aprobar: 'si' })).toEqual({
      aprobar: 'Indique "aprobar": true para aprobarla, false para rechazarla',
    });
  });
});

describe('esquemaEjecutarDevolucion', () => {
  it('una devolución no lleva nada: ni cuerpo', () => {
    const vacia = { items: [], pagos: [], notas: null };
    expect(esquemaEjecutarDevolucion.parse({})).toEqual(vacia);
    expect(esquemaEjecutarDevolucion.parse(undefined)).toEqual(vacia);
    expect(esquemaEjecutarDevolucion.parse({ caja_id: 3 })).toEqual({ ...vacia, caja_id: 3 });
  });

  it('un cambio lleva lo que se lleva el cliente, como una venta, y no admite promoción', () => {
    const datos = esquemaEjecutarDevolucion.parse({
      clave_idempotencia: CLAVE,
      items: [{ variante_id: 12, cantidad: 2 }],
      pagos: [{ metodo: 'efectivo', monto: 300 }],
      notas: ' Cambio de cadena ',
      promocion_id: 4,
      turno_id: 9,
    });
    expect(datos).toEqual({
      clave_idempotencia: CLAVE,
      items: [{ variante_id: 12, cantidad: 2 }],
      pagos: [{ metodo: 'EFECTIVO', moneda: 'NIO', monto: '300', referencia: null }],
      notas: 'Cambio de cadena',
    });
  });

  it('datos inválidos → un mensaje por campo', () => {
    expect(
      mensajes(esquemaEjecutarDevolucion, {
        clave_idempotencia: 'abc',
        items: [{ variante_id: 12, cantidad: 0 }],
        pagos: [{ metodo: 'EFECTIVO', monto: -1 }],
      }),
    ).toEqual({
      clave_idempotencia:
        'clave_idempotencia debe ser un UUID que el POS genera para la venta del cambio',
      'items.0.cantidad': 'La cantidad debe ser un entero de 1 en adelante',
      'pagos.0.monto': 'El monto de cada pago debe ser mayor que 0, con 2 decimales como máximo',
    });
  });
});

describe('esquemaTransferencia y esquemaFiltroDevoluciones', () => {
  it('la referencia de la transferencia: de 3 a 60 caracteres', () => {
    expect(esquemaTransferencia.parse({ referencia: ' BAC-778899 ' })).toEqual({
      referencia: 'BAC-778899',
    });
    expect(mensajes(esquemaTransferencia, { referencia: ' x ' })).toEqual({
      referencia: 'La referencia debe tener al menos 3 caracteres',
    });
    expect(mensajes(esquemaTransferencia, {})).toEqual({
      referencia: 'Escriba la referencia de la transferencia',
    });
  });

  it('filtros de la lista', () => {
    expect(esquemaFiltroDevoluciones.parse({})).toEqual({ limite: 50 });
    expect(
      esquemaFiltroDevoluciones.parse({
        estado: 'aprobada',
        tipo: 'cambio',
        sucursal_id: '2',
        desde: '2026-10-01',
        hasta: '2026-10-08',
        por_transferir: 'true',
        buscar: ' dev-lam ',
        limite: '10',
        antes_de: '40',
      }),
    ).toEqual({
      estado: 'APROBADA',
      tipo: 'CAMBIO',
      sucursal_id: 2,
      desde: '2026-10-01',
      hasta: '2026-10-08',
      por_transferir: true,
      buscar: 'dev-lam',
      limite: 10,
      antes_de: 40,
    });
    expect(
      mensajes(esquemaFiltroDevoluciones, { estado: 'LISTA', tipo: 'X', por_transferir: 'si' }),
    ).toEqual({
      estado: 'estado debe ser PENDIENTE, APROBADA, RECHAZADA, EJECUTADA o CANCELADA',
      tipo: 'tipo debe ser DEVOLUCION o CAMBIO',
      por_transferir: 'por_transferir debe ser true o false',
    });
  });
});
