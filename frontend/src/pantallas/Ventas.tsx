import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { api, detalleDeError } from '../api/cliente';
import type { TurnoActual, VentaDetalle, VentaResumen } from '../api/tipos';
import { BotonImprimir } from '../equipo/BotonImprimir';
import { TicketDigital } from '../equipo/TicketDigital';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { formatoFechaHora, formatoHora, formatoMonto, primerNombre } from '../util/formato';
import { TicketEnLaCola } from '../venta/VentaHecha';

// Las ventas del turno abierto y el detalle de cada una. El arqueo es a ciegas: cada venta muestra
// su monto (hay que poder reimprimirla o anularla), pero aquí nunca se suman.

const volver =
  'flex min-h-toque items-center gap-2 self-start rounded-xl px-2 font-semibold text-esmeralda hover:bg-esmeralda-claro';

/**
 * Las ventas del turno. En el equipo de la sucursal, las del turno abierto de su caja (cada quien
 * ve las suyas; con permiso, todas). Desde el celular la API entrega solo las propias del turno
 * que sigue abierto.
 */
export function VentasDelTurno() {
  const sesion = useSesionActiva();
  const enEquipo = sesion.equipo !== null;
  const turno = useQuery({
    queryKey: ['turno'],
    queryFn: () => api<{ turno: TurnoActual | null }>('GET', '/caja/turno'),
    enabled: enEquipo,
  });
  const abierto = turno.data?.turno ?? null;
  const ruta = enEquipo
    ? abierto && `/ventas?turno_id=${abierto.id}&limite=100`
    : '/ventas?limite=100';
  const lista = useQuery({
    queryKey: ['ventas', 'lista', ruta],
    queryFn: () => api<{ ventas: VentaResumen[] }>('GET', ruta ?? ''),
    enabled: ruta !== null,
  });
  const esAdmin = sesion.usuario.rol.codigo === 'ADMIN';

  return (
    <div className="flex flex-col gap-4">
      <Link to="/venta" className={volver}>
        <ArrowLeft className="size-5" aria-hidden /> Vender
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">
          {enEquipo || !esAdmin ? 'Ventas del turno' : 'Últimas ventas'}
        </h1>
        {abierto && (
          <p className="text-texto-secundario">
            {abierto.sucursal.nombre} · {abierto.caja.nombre}
          </p>
        )}
        {!enEquipo && !esAdmin && (
          <p className="text-texto-secundario">Las que usted hizo en el turno que sigue abierto.</p>
        )}
      </header>

      {(turno.isLoading || lista.isLoading) && <Cargando />}
      {turno.isError && <Aviso tipo="error">{detalleDeError(turno.error)}</Aviso>}
      {lista.isError && <Aviso tipo="error">{detalleDeError(lista.error)}</Aviso>}
      {enEquipo && turno.isSuccess && !abierto && (
        <Aviso tipo="info">La caja está cerrada: no hay un turno abierto.</Aviso>
      )}
      {lista.data?.ventas.length === 0 && (
        <Tarjeta className="text-center text-texto-secundario">Todavía no hay ventas.</Tarjeta>
      )}

      <ul className="flex flex-col gap-3">
        {lista.data?.ventas.map((venta) => (
          <li key={venta.id}>
            <Link
              to={`/venta/del-turno/${venta.id}`}
              className="block rounded-2xl focus-visible:outline-offset-4"
            >
              <Tarjeta className="flex items-center justify-between gap-3 active:bg-esmeralda-claro">
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {venta.numero}
                    {venta.estado === 'ANULADA' && <Etiqueta tono="error">Anulada</Etiqueta>}
                    {venta.origen === 'CELULAR' && <Etiqueta tono="info">Desde celular</Etiqueta>}
                  </span>
                  <span className="block text-sm text-texto-secundario">
                    {formatoHora(venta.fecha)} · {primerNombre(venta.vendedor.nombre_completo)} ·{' '}
                    {venta.articulos === 1 ? '1 artículo' : `${venta.articulos} artículos`}
                  </span>
                </span>
                <span className="flex items-center gap-1 font-semibold whitespace-nowrap">
                  {formatoMonto(venta.total)}
                  <ChevronRight className="size-5 text-texto-secundario" aria-hidden />
                </span>
              </Tarjeta>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span>{etiqueta}</span>
      <span className="text-right font-semibold whitespace-nowrap">{children}</span>
    </li>
  );
}

/** Anular: solo mientras el turno de la venta sigue abierto; devuelve las piezas al inventario. */
function Anular({ venta }: { venta: VentaDetalle }) {
  const consultas = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const anular = useMutation({
    mutationFn: () =>
      api<{ venta: VentaDetalle }>('POST', `/ventas/${venta.id}/anular`, {
        cuerpo: { motivo: motivo.trim() },
      }),
    onSettled: async () => {
      setConfirmar(false);
      await consultas.invalidateQueries({ queryKey: ['ventas'] });
      await consultas.invalidateQueries({ queryKey: ['cola-impresion'] });
    },
  });

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Anular la venta</h2>
      <p className="text-texto-secundario">
        Solo mientras la caja de esta venta siga abierta. Las piezas vuelven al inventario y el
        dinero se le devuelve a la clienta.
      </p>
      <Campo
        etiqueta="Motivo de la anulación"
        name="motivo"
        maxLength={200}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      {anular.isError && <Aviso tipo="error">{detalleDeError(anular.error)}</Aviso>}
      <Boton
        variante="peligro"
        disabled={motivo.trim().length < 5}
        onClick={() => setConfirmar(true)}
      >
        Anular la venta
      </Boton>
      <Confirmacion
        abierta={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo={`¿Anular la factura ${venta.numero}?`}
        textoConfirmar="Sí, anularla"
        peligro
        ocupado={anular.isPending}
        alConfirmar={() => anular.mutate()}
      >
        La venta de {formatoMonto(venta.total)} queda anulada y no se puede deshacer.
      </Confirmacion>
    </Tarjeta>
  );
}

/** Una venta completa: lo que se llevó, cómo se pagó, y su ticket. */
export function VentaVer() {
  const sesion = useSesionActiva();
  const id = Number(useParams().id);
  const consulta = useQuery({
    queryKey: ['ventas', 'detalle', id],
    queryFn: () => api<{ venta: VentaDetalle }>('GET', `/ventas/${id}`),
    enabled: Number.isSafeInteger(id) && id > 0,
  });
  const venta = consulta.data?.venta;
  const imprimeAqui = sesion.equipo !== null || sesion.usuario.rol.codigo === 'ADMIN';
  const moneda = (m: string) => (m === 'USD' ? 'USD' : 'NIO');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link to="/venta/del-turno" className={volver}>
        <ArrowLeft className="size-5" aria-hidden /> Ventas del turno
      </Link>
      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{detalleDeError(consulta.error)}</Aviso>}
      {venta && (
        <>
          <header>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
              Factura {venta.numero}
              {venta.estado === 'ANULADA' && <Etiqueta tono="error">Anulada</Etiqueta>}
            </h1>
            <p className="text-texto-secundario">
              {formatoFechaHora(venta.fecha)} · {venta.sucursal.nombre} · {venta.caja.nombre}
            </p>
            <p className="text-texto-secundario">
              Atendió {venta.vendedor.nombre_completo}
              {venta.cliente_nombre && ` · Cliente: ${venta.cliente_nombre}`}
              {venta.cliente_telefono && ` (${venta.cliente_telefono})`}
            </p>
          </header>

          {venta.anulacion && (
            <Aviso tipo="error">
              <p className="font-semibold">
                Anulada el {formatoFechaHora(venta.anulacion.fecha)} por{' '}
                {venta.anulacion.anulada_por.nombre_completo}
              </p>
              <p className="font-normal">Motivo: {venta.anulacion.motivo}</p>
            </Aviso>
          )}

          <Tarjeta>
            <ul className="divide-y divide-borde">
              {venta.lineas.map((linea) => (
                <li key={linea.id} className="flex items-start justify-between gap-3 py-2">
                  <span>
                    <span className="block font-medium">
                      {linea.cantidad} × {linea.variante.nombre}
                    </span>
                    {linea.piezas.map((pieza) => (
                      <span key={pieza.variante.id} className="block text-sm text-texto-secundario">
                        + {pieza.cantidad > 1 && `${pieza.cantidad} × `}
                        {pieza.variante.nombre}
                      </span>
                    ))}
                    {linea.cantidad > 1 && (
                      <span className="block text-sm text-texto-secundario">
                        {formatoMonto(linea.precio_unitario)} c/u
                      </span>
                    )}
                  </span>
                  <span className="font-semibold whitespace-nowrap">
                    {formatoMonto(linea.subtotal)}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="mt-2 border-t border-borde pt-2">
              {Number(venta.descuento) > 0 && (
                <>
                  <Fila etiqueta="Subtotal">{formatoMonto(venta.subtotal)}</Fila>
                  <Fila etiqueta={<Etiqueta tono="oro">{venta.promocion?.nombre}</Etiqueta>}>
                    −{formatoMonto(venta.descuento)}
                  </Fila>
                </>
              )}
              <Fila etiqueta={<span className="text-lg">Total</span>}>
                <span className="text-xl">{formatoMonto(venta.total)}</span>
              </Fila>
            </ul>
          </Tarjeta>

          <Tarjeta>
            <h2 className="text-lg font-semibold">Pago</h2>
            <ul className="divide-y divide-borde">
              {venta.pagos.map((pago, i) => (
                <Fila
                  key={i}
                  etiqueta={
                    <>
                      {pago.metodo.nombre}
                      {pago.referencia && (
                        <span className="text-sm text-texto-secundario">
                          {' '}
                          · ref. {pago.referencia}
                        </span>
                      )}
                    </>
                  }
                >
                  {formatoMonto(pago.monto, moneda(pago.moneda))}
                </Fila>
              ))}
              {Number(venta.vuelto) > 0 && (
                <Fila etiqueta="Vuelto">{formatoMonto(venta.vuelto)}</Fila>
              )}
            </ul>
          </Tarjeta>

          {imprimeAqui && (
            <BotonImprimir ruta={`/ventas/${venta.id}/imprimir`} texto="Imprimir el ticket" />
          )}
          <TicketEnLaCola venta={venta} />
          <TicketDigital ventaId={venta.id} numero={venta.numero} />

          {venta.estado === 'COMPLETADA' && tienePermiso(sesion, ['VENTAS_ANULAR']) && (
            <Anular venta={venta} />
          )}
        </>
      )}
    </div>
  );
}
