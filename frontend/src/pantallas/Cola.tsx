import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, detalleDeError } from '../api/cliente';
import type { TicketEnCola } from '../api/tipos';
import { useCola } from '../equipo/cola';
import { Aviso, Boton, Etiqueta, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { formatoHora } from '../util/formato';

/**
 * «Tickets por imprimir»: los de las ventas hechas desde un celular, que salen en este equipo. Se
 * imprimen con un toque (o solos, si así está configurado) y, si no hacen falta, se quitan con
 * «No imprimir», que anota quién lo decidió.
 */
export function TicketsPorImprimir() {
  const cola = useCola();
  const consultas = useQueryClient();
  const [porQuitar, setPorQuitar] = useState<TicketEnCola | null>(null);
  const quitar = useMutation({
    mutationFn: (id: number) => api<void>('POST', `/cola-impresion/${id}/no-imprimir`),
    onSettled: async () => {
      setPorQuitar(null);
      await consultas.invalidateQueries({ queryKey: ['cola-impresion'] });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link
        to="/venta"
        className="flex min-h-toque items-center gap-2 self-start rounded-xl px-2 font-semibold text-esmeralda hover:bg-esmeralda-claro"
      >
        <ArrowLeft className="size-5" aria-hidden /> Vender
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">Tickets por imprimir</h1>
        <p className="text-texto-secundario">
          Los de las ventas hechas desde un celular.{' '}
          {cola.atendida &&
            (cola.automatica
              ? 'Este equipo los imprime solo, en cuanto llegan.'
              : 'Toque «Imprimir» para sacar cada uno.')}
        </p>
      </header>

      {!cola.atendida && (
        <Aviso tipo="info">
          Los tickets salen en el equipo registrado de la sucursal (el que tiene la impresora), no
          en este.
        </Aviso>
      )}
      {cola.atendida && cola.tickets.length === 0 && (
        <Tarjeta className="text-center text-texto-secundario">
          No hay ningún ticket esperando.
        </Tarjeta>
      )}
      {quitar.isError && <Aviso tipo="error">{detalleDeError(quitar.error)}</Aviso>}

      <ul className="flex flex-col gap-3">
        {cola.tickets.map((ticket) => {
          const estado = cola.estados[ticket.id];
          const imprimiendo = estado?.fase === 'imprimiendo';
          return (
            <li key={ticket.id}>
              <Tarjeta className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="block font-semibold">{ticket.numero}</span>
                    <span className="block text-sm text-texto-secundario">
                      {formatoHora(ticket.fecha)} · vendió {ticket.vendedor}
                    </span>
                  </span>
                  {ticket.en_curso && <Etiqueta tono="info">Imprimiéndose en otro equipo</Etiqueta>}
                </div>
                {estado?.fase === 'error' && (
                  <Aviso tipo="error">No se pudo imprimir. {estado.mensaje}</Aviso>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Boton
                    className="flex-1"
                    ocupado={imprimiendo}
                    disabled={ticket.en_curso}
                    onClick={() => void cola.imprimir(ticket.id)}
                  >
                    <Printer className="size-5" aria-hidden />
                    {estado?.fase === 'error' ? 'Reintentar' : 'Imprimir'}
                  </Boton>
                  <Boton
                    variante="secundario"
                    disabled={imprimiendo}
                    onClick={() => setPorQuitar(ticket)}
                  >
                    No imprimir
                  </Boton>
                </div>
              </Tarjeta>
            </li>
          );
        })}
      </ul>

      <Confirmacion
        abierta={porQuitar !== null}
        alCerrar={() => setPorQuitar(null)}
        titulo={`¿No imprimir el ticket ${porQuitar?.numero ?? ''}?`}
        textoConfirmar="No imprimirlo"
        ocupado={quitar.isPending}
        alConfirmar={() => porQuitar && quitar.mutate(porQuitar.id)}
      >
        Sale de la lista sin imprimirse y queda anotado quién lo decidió. Si después hace falta, se
        imprime desde la venta.
      </Confirmacion>
    </div>
  );
}
