import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api, detalleDeError } from '../api/cliente';
import type { DevolucionDetalle } from '../api/tipos';
import { AnotarTransferencia } from '../devoluciones/AnotarTransferencia';
import { enlaceDeAviso } from '../devoluciones/aviso';
import { EtiquetaDeEstado, enlaceVolver, nombreDeTipo } from '../devoluciones/presentacion';
import { BotonImprimir } from '../equipo/BotonImprimir';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { formatoDia, formatoFecha, formatoFechaHora, formatoMonto } from '../util/formato';

// Una solicitud de devolución o de cambio, de principio a fin: qué se devuelve, cuánto vale y en
// qué va. El administrador la aprueba o la rechaza aquí; quien la solicitó la puede cancelar. La
// aprobada se ejecuta en el equipo de la sucursal donde esté el cliente; ya ejecutada, el
// administrador anota aquí la transferencia de lo que no salió de la caja.

function Fila({ etiqueta, children }: { etiqueta: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span>{etiqueta}</span>
      <span className="text-right font-semibold whitespace-nowrap">{children}</span>
    </li>
  );
}

/** En qué va la solicitud, con el color de cada cosa: ámbar lo pendiente, rojo solo el rechazo. */
function Estado({
  devolucion,
  aprueba,
  ejecutaAqui,
}: {
  devolucion: DevolucionDetalle;
  aprueba: boolean;
  /** Es el equipo de una sucursal y quien está puede ejecutarla. */
  ejecutaAqui: boolean;
}) {
  const { resolucion, cancelacion, ejecucion } = devolucion;
  const aviso = enlaceDeAviso(devolucion);
  switch (devolucion.estado) {
    case 'PENDIENTE':
      return (
        <Aviso tipo="aviso">
          <p className="font-semibold">Esperando la aprobación del administrador.</p>
          {!aprueba && (
            <p className="font-normal">
              Esta pantalla se actualiza sola: no hace falta volver a buscarla.
            </p>
          )}
          {!aprueba && aviso && (
            <a
              href={aviso}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-toque items-center justify-center gap-2 rounded-xl border border-borde bg-superficie px-5 text-base font-semibold text-texto hover:bg-esmeralda-claro"
            >
              <MessageCircle className="size-5" aria-hidden /> Avisar al administrador
            </a>
          )}
        </Aviso>
      );
    case 'APROBADA':
      return (
        <>
          <Aviso tipo="exito">
            <p className="font-semibold">
              Aprobada
              {resolucion &&
                ` por ${resolucion.resuelta_por.nombre_completo} el ${formatoFechaHora(resolucion.fecha)}`}
              .
            </p>
            {devolucion.vence_el && (
              <p className="font-normal">
                Se puede ejecutar hasta el {formatoDia(devolucion.vence_el)}, en la caja de
                cualquier sucursal; después se cancela sola.
              </p>
            )}
            {resolucion?.comentario && (
              <p className="font-normal">Comentario: {resolucion.comentario}</p>
            )}
          </Aviso>
          {ejecutaAqui ? (
            <Link
              to={`/devoluciones/${devolucion.id}/ejecutar`}
              className="inline-flex min-h-toque items-center justify-center gap-2 rounded-xl bg-esmeralda px-5 font-semibold text-white hover:bg-esmeralda-oscuro"
            >
              <Undo2 className="size-5" aria-hidden /> Ejecutar en caja
            </Link>
          ) : (
            <Aviso tipo="info">
              Se ejecuta (recibir el producto y entregar el dinero o el cambio) en el equipo de la
              sucursal donde esté el cliente, con la caja abierta.
            </Aviso>
          )}
        </>
      );
    case 'RECHAZADA':
      return (
        <Aviso tipo="error">
          <p className="font-semibold">
            Rechazada
            {resolucion &&
              ` por ${resolucion.resuelta_por.nombre_completo} el ${formatoFechaHora(resolucion.fecha)}`}
            .
          </p>
          {resolucion?.comentario && <p className="font-normal">Motivo: {resolucion.comentario}</p>}
        </Aviso>
      );
    case 'CANCELADA':
      return (
        <Aviso tipo="info">
          <p className="font-semibold">
            {cancelacion?.cancelada_por
              ? `Cancelada por ${cancelacion.cancelada_por.nombre_completo} el ${formatoFechaHora(cancelacion.fecha)}.`
              : 'Venció sin ejecutarse y se canceló sola.'}
          </p>
          {cancelacion && <p className="font-normal">Motivo: {cancelacion.motivo}</p>}
        </Aviso>
      );
    default:
      return (
        <Aviso tipo="exito">
          <p className="font-semibold">Ejecutada{devolucion.numero && `: ${devolucion.numero}`}.</p>
          {ejecucion && (
            <p className="font-normal">
              {formatoFechaHora(ejecucion.fecha)} · {devolucion.sucursal?.nombre} ·{' '}
              {ejecucion.caja.nombre} · {ejecucion.ejecutada_por.nombre_completo}
            </p>
          )}
        </Aviso>
      );
  }
}

/** Cómo recibe el cliente lo devuelto: lo previsto antes de ejecutar, lo definitivo después. */
function Reembolso({ devolucion }: { devolucion: DevolucionDetalle }) {
  const { reembolso } = devolucion;
  if (!reembolso) {
    if (devolucion.tipo !== 'CAMBIO' || devolucion.estado === 'EJECUTADA') return null;
    return (
      <p className="text-texto-secundario">
        Es un cambio: lo que se lleva el cliente se elige al ejecutarlo, y este monto se le aplica a
        esa compra.
      </p>
    );
  }
  return (
    <div>
      <h2 className="text-lg font-semibold">
        {reembolso.definitivo ? 'Cómo se entregó' : 'Cómo se entregará'}
      </h2>
      <ul className="divide-y divide-borde">
        {Number(reembolso.saldo) > 0 && (
          <Fila
            etiqueta={
              devolucion.venta_cambio
                ? `Aplicado a la factura ${devolucion.venta_cambio.numero}`
                : 'Aplicado al cambio'
            }
          >
            {formatoMonto(reembolso.saldo)}
          </Fila>
        )}
        {Number(reembolso.efectivo) > 0 && (
          <Fila etiqueta="En efectivo, de la caja">{formatoMonto(reembolso.efectivo)}</Fila>
        )}
        {Number(reembolso.transferencia) > 0 && (
          <Fila etiqueta="Por transferencia (la hace la administración)">
            {formatoMonto(reembolso.transferencia)}
          </Fila>
        )}
      </ul>
      {!reembolso.definitivo && (
        <p className="text-sm text-texto-secundario">
          Se reparte según cómo se pagó la factura: lo pagado en efectivo sale de la caja; lo pagado
          con tarjeta o transferencia se le transfiere.
        </p>
      )}
      {devolucion.transferencia && (
        <p className="text-sm text-texto-secundario">
          Transferido el {formatoFechaHora(devolucion.transferencia.fecha)}, ref.{' '}
          {devolucion.transferencia.referencia}.
        </p>
      )}
    </div>
  );
}

/** Solo el administrador: aprobar, o rechazar diciendo por qué. */
function Resolver({ devolucion }: { devolucion: DevolucionDetalle }) {
  const consultas = useQueryClient();
  const [comentario, setComentario] = useState('');
  const [porConfirmar, setPorConfirmar] = useState<'aprobar' | 'rechazar' | null>(null);
  const esta = devolucion.tipo === 'CAMBIO' ? 'este cambio' : 'esta devolución';
  const resolver = useMutation({
    mutationFn: (aprobar: boolean) =>
      api<{ devolucion: DevolucionDetalle }>('POST', `/devoluciones/${devolucion.id}/resolver`, {
        cuerpo: { aprobar, ...(comentario.trim() ? { comentario: comentario.trim() } : {}) },
      }),
    onSettled: async () => {
      setPorConfirmar(null);
      await consultas.invalidateQueries({ queryKey: ['devoluciones'] });
      await consultas.invalidateQueries({ queryKey: ['alertas'] });
    },
  });

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Aprobar o rechazar</h2>
      <Campo
        etiqueta="Comentario (obligatorio para rechazar)"
        name="comentario"
        maxLength={300}
        value={comentario}
        onChange={(evento) => setComentario(evento.target.value)}
      />
      {resolver.isError && <Aviso tipo="error">{detalleDeError(resolver.error)}</Aviso>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Boton className="flex-1" onClick={() => setPorConfirmar('aprobar')}>
          Aprobar
        </Boton>
        <Boton
          className="flex-1"
          variante="peligro"
          disabled={comentario.trim().length < 5}
          onClick={() => setPorConfirmar('rechazar')}
        >
          Rechazar
        </Boton>
      </div>
      <Confirmacion
        abierta={porConfirmar !== null}
        alCerrar={() => setPorConfirmar(null)}
        titulo={porConfirmar === 'rechazar' ? `¿Rechazar ${esta}?` : `¿Aprobar ${esta}?`}
        textoConfirmar={porConfirmar === 'rechazar' ? 'Sí, rechazar' : 'Sí, aprobar'}
        peligro={porConfirmar === 'rechazar'}
        ocupado={resolver.isPending}
        alConfirmar={() => resolver.mutate(porConfirmar === 'aprobar')}
      >
        {porConfirmar === 'rechazar'
          ? `Se le avisa a la sucursal con su comentario: «${comentario.trim()}».`
          : `Factura ${devolucion.venta.numero}, ${formatoMonto(devolucion.monto_total)}. Queda lista para ejecutarse en caja.`}
      </Confirmacion>
    </Tarjeta>
  );
}

/** Quien la solicitó o el administrador, mientras no se haya ejecutado. */
function Cancelar({ devolucion }: { devolucion: DevolucionDetalle }) {
  const consultas = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const cancelar = useMutation({
    mutationFn: () =>
      api<{ devolucion: DevolucionDetalle }>('POST', `/devoluciones/${devolucion.id}/cancelar`, {
        cuerpo: { motivo: motivo.trim() },
      }),
    onSettled: async () => {
      setConfirmar(false);
      await consultas.invalidateQueries({ queryKey: ['devoluciones'] });
      await consultas.invalidateQueries({ queryKey: ['alertas'] });
    },
  });

  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Cancelar la solicitud</h2>
      <p className="text-texto-secundario">
        Si el cliente ya no la quiere o se hizo por error. Lo apartado vuelve a quedar disponible.
      </p>
      <Campo
        etiqueta="Motivo de la cancelación"
        name="motivo-cancelacion"
        maxLength={200}
        value={motivo}
        onChange={(evento) => setMotivo(evento.target.value)}
      />
      {cancelar.isError && <Aviso tipo="error">{detalleDeError(cancelar.error)}</Aviso>}
      <Boton
        variante="secundario"
        disabled={motivo.trim().length < 5}
        onClick={() => setConfirmar(true)}
      >
        Cancelar la solicitud
      </Boton>
      <Confirmacion
        abierta={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="¿Cancelar esta solicitud?"
        textoConfirmar="Sí, cancelarla"
        textoCancelar="No, dejarla"
        peligro
        ocupado={cancelar.isPending}
        alConfirmar={() => cancelar.mutate()}
      >
        No se puede deshacer: si hace falta, se solicita otra.
      </Confirmacion>
    </Tarjeta>
  );
}

export function DevolucionVer() {
  const sesion = useSesionActiva();
  const id = Number(useParams().id);
  const recienEnviada = (useLocation().state as { enviada?: boolean } | null)?.enviada === true;
  const aprueba = tienePermiso(sesion, ['DEVOLUCIONES_APROBAR']);
  const consulta = useQuery({
    queryKey: ['devoluciones', 'detalle', id],
    queryFn: () => api<{ devolucion: DevolucionDetalle }>('GET', `/devoluciones/${id}`),
    enabled: Number.isSafeInteger(id) && id > 0,
    // Mientras espera la aprobación se vuelve a preguntar sola: quien la solicitó la ve cambiar
    refetchInterval: (actual) =>
      actual.state.data?.devolucion.estado === 'PENDIENTE' ? 15_000 : false,
  });
  const devolucion = consulta.data?.devolucion;
  const sinEjecutar = devolucion?.estado === 'PENDIENTE' || devolucion?.estado === 'APROBADA';
  const enEquipo = sesion.equipo !== null;
  const ejecutaAqui = enEquipo && tienePermiso(sesion, ['DEVOLUCIONES_REGISTRAR']);
  // La cancela quien la solicitó; el administrador, la que ya aprobó (la pendiente la rechaza)
  const puedeCancelar =
    sinEjecutar &&
    (devolucion.solicitada_por.id === sesion.usuario.id ||
      (aprueba && devolucion.estado === 'APROBADA'));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link to="/devoluciones" className={enlaceVolver}>
        <ArrowLeft className="size-5" aria-hidden /> Devoluciones
      </Link>
      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{detalleDeError(consulta.error)}</Aviso>}
      {devolucion && (
        <>
          <header>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
              {nombreDeTipo(devolucion.tipo)} n.º {devolucion.id}
              <EtiquetaDeEstado devolucion={devolucion} />
              {devolucion.por_transferir && (
                <Etiqueta tono="aviso">Falta la transferencia</Etiqueta>
              )}
            </h1>
            <p className="text-texto-secundario">
              Factura{' '}
              <Link
                to={`/devoluciones/factura/${devolucion.venta.numero}`}
                className="font-semibold text-esmeralda underline"
              >
                {devolucion.venta.numero}
              </Link>{' '}
              del {formatoFecha(devolucion.venta.fecha)} · {devolucion.venta.sucursal.nombre}
            </p>
            <p className="text-texto-secundario">
              La solicitó {devolucion.solicitada_por.nombre_completo} el{' '}
              {formatoFechaHora(devolucion.solicitada_at)} en {devolucion.sucursal_solicitud.nombre}
            </p>
          </header>

          {recienEnviada && devolucion.estado === 'PENDIENTE' && (
            <Aviso tipo="exito">Solicitud enviada.</Aviso>
          )}
          <Estado devolucion={devolucion} aprueba={aprueba} ejecutaAqui={ejecutaAqui} />

          <Tarjeta className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold">Lo que devuelve</h2>
              <ul className="divide-y divide-borde">
                {devolucion.lineas.map((linea) => (
                  <li key={linea.id} className="flex items-start justify-between gap-3 py-2">
                    <span>
                      <span className="block font-medium">
                        {linea.cantidad} × {linea.variante.nombre}
                      </span>
                      {(linea.estado_recibido ?? linea.estado_producto) === 'DEFECTUOSO' && (
                        <Etiqueta tono="aviso">Defectuoso</Etiqueta>
                      )}
                      {linea.estado_recibido && linea.estado_recibido !== linea.estado_producto && (
                        <span className="block text-sm text-texto-secundario">
                          Se pidió{' '}
                          {linea.estado_producto === 'DEFECTUOSO'
                            ? 'como defectuoso'
                            : 'en buen estado'}{' '}
                          y se recibió{' '}
                          {linea.estado_recibido === 'DEFECTUOSO' ? 'defectuoso' : 'en buen estado'}
                          .
                        </span>
                      )}
                    </span>
                    <span className="font-semibold whitespace-nowrap">
                      {formatoMonto(linea.monto)}
                    </span>
                  </li>
                ))}
              </ul>
              <ul className="border-t border-borde">
                <Fila etiqueta={<span className="text-lg">Monto</span>}>
                  <span className="text-xl">{formatoMonto(devolucion.monto_total)}</span>
                </Fila>
              </ul>
            </div>
            <Reembolso devolucion={devolucion} />
          </Tarjeta>

          <Tarjeta>
            <h2 className="text-lg font-semibold">Motivo y cliente</h2>
            <p className="mt-1">{devolucion.motivo}</p>
            <p className="mt-2 text-texto-secundario">
              {devolucion.cliente_nombre} · {devolucion.cliente_telefono}
            </p>
          </Tarjeta>

          {aprueba && devolucion.por_transferir && (
            <Tarjeta className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Falta la transferencia</h2>
              <p className="text-texto-secundario">
                Transfiérale al cliente {formatoMonto(devolucion.monto_transferencia ?? '0')} (lo
                que pagó con tarjeta o transferencia) y anote la referencia.
              </p>
              <AnotarTransferencia devolucion={devolucion} />
            </Tarjeta>
          )}
          {devolucion.estado === 'EJECUTADA' && enEquipo && (
            <BotonImprimir
              ruta={`/devoluciones/${devolucion.id}/imprimir`}
              texto="Imprimir el ticket"
            />
          )}
          {aprueba && devolucion.estado === 'PENDIENTE' && <Resolver devolucion={devolucion} />}
          {puedeCancelar && <Cancelar devolucion={devolucion} />}
        </>
      )}
    </div>
  );
}
