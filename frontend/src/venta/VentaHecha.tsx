import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detalleDeError } from '../api/cliente';
import type { VentaDetalle } from '../api/tipos';
import { BotonImprimir } from '../equipo/BotonImprimir';
import { TicketDigital } from '../equipo/TicketDigital';
import { useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Tarjeta } from '../ui/basicos';
import { formatoMonto } from '../util/formato';

/**
 * Cómo va el ticket de una venta hecha desde un celular: espera en la cola de impresión del equipo
 * de la sucursal hasta que sale por la impresora. Quien vendió puede decir que no hace falta.
 */
export function TicketEnLaCola({ venta }: { venta: VentaDetalle }) {
  const consultas = useQueryClient();
  const clave = ['ventas', 'detalle', venta.id];
  const actual = useQuery({
    queryKey: clave,
    queryFn: () => api<{ venta: VentaDetalle }>('GET', `/ventas/${venta.id}`),
    initialData: { venta },
    // mientras espera, se pregunta cada pocos segundos si ya salió
    refetchInterval: (consulta) =>
      consulta.state.data?.venta.cola?.estado === 'PENDIENTE' ? 5_000 : false,
    retry: false,
  });
  const cola = actual.data.venta.cola;
  const quitar = useMutation({
    mutationFn: () => api<void>('POST', `/cola-impresion/${cola?.id}/no-imprimir`),
    onSettled: () => consultas.invalidateQueries({ queryKey: clave }),
  });
  if (!cola) return null;

  if (cola.estado === 'IMPRESO') {
    return <Aviso tipo="exito">El ticket ya salió impreso en la sucursal.</Aviso>;
  }
  if (cola.estado === 'NO_IMPRESO') {
    return <Aviso tipo="info">El ticket no se imprimió en papel.</Aviso>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Aviso tipo="info">
        <p className="font-semibold">El ticket está en «Tickets por imprimir»</p>
        <p className="font-normal">
          Sale en el equipo de {venta.sucursal.nombre}. Aquí se avisa cuando ya esté impreso.
        </p>
      </Aviso>
      {quitar.isError && <Aviso tipo="error">{detalleDeError(quitar.error)}</Aviso>}
      <Boton variante="texto" ocupado={quitar.isPending} onClick={() => quitar.mutate()}>
        No hace falta imprimirlo
      </Boton>
    </div>
  );
}

/** La venta ya quedó registrada: el vuelto que se entrega y el ticket, en papel o digital. */
export function VentaHecha({ venta, alSeguir }: { venta: VentaDetalle; alSeguir: () => void }) {
  const sesion = useSesionActiva();
  const enEquipo = sesion.equipo !== null;
  // Imprimir en papel es del equipo de la sucursal; el administrador lo hace desde donde esté
  const imprimeAqui = enEquipo || sesion.usuario.rol.codigo === 'ADMIN';
  const vuelto = Number(venta.vuelto);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <Aviso tipo="exito">
        <p className="font-semibold">Venta registrada</p>
        <p className="font-normal">Factura {venta.numero}</p>
      </Aviso>

      <Tarjeta className="flex flex-col gap-3">
        <p className="flex items-baseline justify-between gap-3">
          <span>Total</span>
          <span className="text-xl font-semibold">{formatoMonto(venta.total)}</span>
        </p>
        <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-3">
          <span className="text-lg">{vuelto > 0 ? 'Entregue de vuelto' : 'Vuelto'}</span>
          <span className="text-3xl font-semibold">
            {vuelto > 0 ? formatoMonto(venta.vuelto) : 'Sin vuelto'}
          </span>
        </p>
      </Tarjeta>

      {imprimeAqui && <BotonImprimir ruta={`/ventas/${venta.id}/imprimir`} automatico={enEquipo} />}
      <TicketEnLaCola venta={venta} />
      <TicketDigital ventaId={venta.id} numero={venta.numero} />

      <Boton onClick={alSeguir}>Nueva venta</Boton>
    </div>
  );
}
