import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Phone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { detalleDeError } from '../api/cliente';
import { porTransferir } from '../api/consultas';
import type { DevolucionDetalle } from '../api/tipos';
import { AnotarTransferencia } from '../devoluciones/AnotarTransferencia';
import { enlaceVolver, nombreDeTipo } from '../devoluciones/presentacion';
import { Aviso, Cargando, Tarjeta } from '../ui/basicos';
import { formatoFechaHora, formatoMonto } from '../util/formato';

// Las devoluciones ya ejecutadas a las que les falta la transferencia del administrador: lo que el
// cliente pagó con tarjeta o transferencia no sale de la caja, se le transfiere. Es para el
// administrador, también desde su celular. Cada una con su monto; nunca una suma.

export function Transferencias() {
  const lista = useQuery({ ...porTransferir, refetchInterval: 60_000 });
  const [anotada, setAnotada] = useState<DevolucionDetalle | null>(null);
  const devoluciones = lista.data?.devoluciones ?? [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link to="/devoluciones" className={enlaceVolver}>
        <ArrowLeft className="size-5" aria-hidden /> Devoluciones
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">Transferencias pendientes</h1>
        <p className="text-texto-secundario">
          Lo que se le devuelve al cliente de lo que pagó con tarjeta o transferencia: no sale de la
          caja. Cuando la haga, anote aquí su referencia.
        </p>
      </header>

      {anotada && (
        <Aviso tipo="exito">
          Transferencia de {anotada.numero} anotada
          {anotada.transferencia && ` (ref. ${anotada.transferencia.referencia})`}.
        </Aviso>
      )}
      {lista.isPending && <Cargando />}
      {lista.isError && <Aviso tipo="error">{detalleDeError(lista.error)}</Aviso>}
      {lista.isSuccess && devoluciones.length === 0 && (
        <Tarjeta className="text-center text-texto-secundario">
          No hay transferencias pendientes.
        </Tarjeta>
      )}

      <ul className="flex flex-col gap-3" aria-label="Por transferir">
        {devoluciones.map((d) => (
          <li key={d.id}>
            <Tarjeta className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{d.cliente_nombre}</p>
                  <a
                    href={`tel:${d.cliente_telefono.replace(/[^\d+]/g, '')}`}
                    className="inline-flex min-h-toque items-center gap-2 font-semibold text-esmeralda underline"
                  >
                    <Phone className="size-4" aria-hidden /> {d.cliente_telefono}
                  </a>
                </div>
                <p className="text-right">
                  <span className="block text-sm text-texto-secundario">Por transferir</span>
                  <span className="text-2xl font-semibold whitespace-nowrap">
                    {formatoMonto(d.monto_transferencia ?? '0')}
                  </span>
                </p>
              </div>
              <p className="text-sm text-texto-secundario">
                {nombreDeTipo(d.tipo)} {d.numero} · Factura {d.venta.numero}
                {d.sucursal && ` · ${d.sucursal.nombre}`}
                {d.ejecutada_at && ` · ${formatoFechaHora(d.ejecutada_at)}`}
              </p>
              <Link
                to={`/devoluciones/${d.id}`}
                className="self-start font-semibold text-esmeralda underline"
              >
                Ver la devolución
              </Link>
              <AnotarTransferencia devolucion={d} alAnotar={setAnotada} />
            </Tarjeta>
          </li>
        ))}
      </ul>
    </div>
  );
}
