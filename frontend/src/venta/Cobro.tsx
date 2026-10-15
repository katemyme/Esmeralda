import { ArrowLeft, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ErrorApi, detalleDeError } from '../api/cliente';
import type { MetodoPago } from '../api/tipos';
import { Aviso, Boton, Campo, Selector, Tarjeta } from '../ui/basicos';
import { deCentavos } from '../util/dinero';
import { botonRedondo, pesos } from './ArmarVenta';
import { cuenta, enCordobas, nuevoPago, type Moneda, type Pago } from './carrito';

// El cobro: una o varias formas de pago (córdobas, dólares, tarjeta, transferencia), lo que falta y
// el vuelto. Lo usan la venta y el cambio de una devolución (ahí se cobra solo la diferencia).

export function Fila({ etiqueta, children }: { etiqueta: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span>{etiqueta}</span>
      <span className="font-semibold whitespace-nowrap">{children}</span>
    </p>
  );
}

const OPCION = (codigo: string, moneda: Moneda) => `${codigo}|${moneda}`;

export function Cobro({
  total,
  pagos,
  metodos,
  usdANio,
  cliente,
  alCambiarPagos,
  alCambiarCliente,
  alVolver,
  alRegistrar,
  registrando,
  error,
  titulo = 'Cobrar',
  etiquetaTotal = 'Total a cobrar',
  textoRegistrar = 'Registrar la venta',
  sinConexion:
    textoSinConexion = 'No hay conexión con el servidor, así que la venta no está confirmada. Revise el internet y toque «Reintentar»: si ya había entrado, no se duplica.',
  conCliente: ofreceCliente = true,
  arriba,
}: {
  total: number;
  pagos: Pago[];
  metodos: MetodoPago[];
  /** El tipo de cambio vigente; null solo si no hay ninguno (entonces no se cobra en dólares). */
  usdANio: string | null;
  cliente: { nombre: string; telefono: string };
  alCambiarPagos: (pagos: Pago[]) => void;
  alCambiarCliente: (cliente: { nombre: string; telefono: string }) => void;
  alVolver: () => void;
  alRegistrar: () => void;
  registrando: boolean;
  error: unknown;
  titulo?: string;
  etiquetaTotal?: string;
  textoRegistrar?: string;
  /** Qué se dice si no hay conexión (lo enviado no está confirmado; reintentar no duplica). */
  sinConexion?: string;
  /** Ofrecer anotar el nombre y el teléfono del cliente (en un cambio ya vienen de la solicitud). */
  conCliente?: boolean;
  /** Lo que va entre el total y los pagos (en un cambio: lo devuelto y lo nuevo). */
  arriba?: ReactNode;
}) {
  const [conCliente, setConCliente] = useState(false);
  const estado = cuenta(total, pagos, metodos, usdANio);
  const opciones = metodos.flatMap((m) =>
    m.es_efectivo
      ? [
          { valor: OPCION(m.codigo, 'NIO'), texto: `${m.nombre} en córdobas`, sirve: true },
          {
            valor: OPCION(m.codigo, 'USD'),
            texto: `${m.nombre} en dólares`,
            sirve: usdANio !== null,
          },
        ]
      : [{ valor: OPCION(m.codigo, 'NIO'), texto: m.nombre, sirve: true }],
  );
  const cambiar = (clave: string, cambio: Partial<Pago>) =>
    alCambiarPagos(pagos.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)));
  const sinConexion = error instanceof ErrorApi && error.codigo === 'SIN_CONEXION';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <button
          type="button"
          className={botonRedondo}
          aria-label="Volver a la venta"
          onClick={alVolver}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
      </header>

      {arriba}
      <Tarjeta className="flex items-baseline justify-between gap-3">
        <span className="text-lg">{etiquetaTotal}</span>
        <span className="text-3xl font-semibold">{pesos(total)}</span>
      </Tarjeta>

      {usdANio === null && (
        <Aviso tipo="aviso">
          No hay tipo de cambio: mientras el administrador no lo ponga, no se cobra en dólares.
        </Aviso>
      )}

      {pagos.map((pago, i) => {
        const metodo = metodos.find((m) => m.codigo === pago.metodo);
        const numero = pagos.length > 1 ? ` ${i + 1}` : '';
        const faltaSinEste =
          total - pagos.reduce((s, p) => s + (p === pago ? 0 : (enCordobas(p, usdANio) ?? 0)), 0);
        const enNio = pago.moneda === 'USD' ? enCordobas(pago, usdANio) : null;
        return (
          <Tarjeta key={pago.clave} className="flex flex-col gap-3">
            <Selector
              etiqueta={`Forma de pago${numero}`}
              name={`metodo-${pago.clave}`}
              value={OPCION(pago.metodo, pago.moneda)}
              onChange={(e) => {
                const [codigo, moneda] = e.target.value.split('|');
                cambiar(pago.clave, { metodo: codigo, moneda: moneda as Moneda, referencia: '' });
              }}
            >
              {opciones.map((o) => (
                <option key={o.valor} value={o.valor} disabled={!o.sirve}>
                  {o.texto}
                </option>
              ))}
            </Selector>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Campo
                  etiqueta={`Monto${numero} (${pago.moneda === 'USD' ? 'US$' : 'C$'})`}
                  name={`monto-${pago.clave}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={pago.monto}
                  onChange={(e) => cambiar(pago.clave, { monto: e.target.value })}
                  ayuda={enNio !== null ? `Equivale a ${pesos(enNio)}` : undefined}
                />
              </div>
              {pago.moneda === 'NIO' && faltaSinEste > 0 && (
                <Boton
                  variante="secundario"
                  onClick={() => cambiar(pago.clave, { monto: deCentavos(faltaSinEste) })}
                >
                  Exacto
                </Boton>
              )}
            </div>
            {metodo?.requiere_referencia && (
              <Campo
                etiqueta={`Referencia${numero} (número del voucher o de la transferencia)`}
                name={`referencia-${pago.clave}`}
                autoComplete="off"
                maxLength={60}
                value={pago.referencia}
                onChange={(e) => cambiar(pago.clave, { referencia: e.target.value })}
              />
            )}
            {pagos.length > 1 && (
              <Boton
                variante="texto"
                className="self-start px-3"
                onClick={() => alCambiarPagos(pagos.filter((p) => p !== pago))}
              >
                Quitar este pago
              </Boton>
            )}
          </Tarjeta>
        );
      })}
      <Boton
        variante="secundario"
        onClick={() => alCambiarPagos([...pagos, nuevoPago(metodos[0]?.codigo ?? 'EFECTIVO')])}
      >
        <Plus className="size-5" aria-hidden /> Agregar otra forma de pago
      </Boton>

      <Tarjeta className="flex flex-col gap-2">
        <Fila etiqueta="Pagado">{pesos(estado.pagado)}</Fila>
        {estado.falta > 0 ? (
          <Fila etiqueta="Falta">
            <span className="text-aviso">{pesos(estado.falta)}</span>
          </Fila>
        ) : (
          <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-2">
            <span className="text-lg">Vuelto</span>
            <span className="text-2xl font-semibold">{pesos(estado.vuelto)}</span>
          </p>
        )}
        {estado.pendiente && <p className="text-sm text-texto-secundario">{estado.pendiente}</p>}
      </Tarjeta>

      {!ofreceCliente ? null : conCliente ? (
        <Tarjeta className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Nombre del cliente (opcional)"
            name="cliente_nombre"
            maxLength={120}
            value={cliente.nombre}
            onChange={(e) => alCambiarCliente({ ...cliente, nombre: e.target.value })}
          />
          <Campo
            etiqueta="Teléfono (opcional)"
            name="cliente_telefono"
            inputMode="tel"
            maxLength={20}
            value={cliente.telefono}
            onChange={(e) => alCambiarCliente({ ...cliente, telefono: e.target.value })}
          />
        </Tarjeta>
      ) : (
        <Boton variante="texto" className="self-start" onClick={() => setConCliente(true)}>
          Anotar el nombre del cliente
        </Boton>
      )}

      {error !== null &&
        (sinConexion ? (
          <Aviso tipo="error">{textoSinConexion}</Aviso>
        ) : (
          <Aviso tipo="error">{detalleDeError(error)}</Aviso>
        ))}
      <Boton ocupado={registrando} disabled={estado.pendiente !== null} onClick={alRegistrar}>
        {sinConexion ? 'Reintentar' : textoRegistrar}
      </Boton>
    </div>
  );
}
