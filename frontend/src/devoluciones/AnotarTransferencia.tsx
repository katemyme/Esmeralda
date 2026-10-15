import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, detalleDeError } from '../api/cliente';
import type { DevolucionDetalle, DevolucionResumen } from '../api/tipos';
import { Aviso, Boton, Campo } from '../ui/basicos';

/**
 * El administrador anota la referencia de la transferencia con que le devolvió al cliente lo que
 * pagó con tarjeta o transferencia (no sale de la caja). Anotada, la devolución deja de estar
 * «por transferir» y su alerta se da por atendida.
 */
export function AnotarTransferencia({
  devolucion,
  alAnotar,
}: {
  devolucion: DevolucionResumen;
  alAnotar?: (devolucion: DevolucionDetalle) => void;
}) {
  const consultas = useQueryClient();
  const [referencia, setReferencia] = useState('');
  const anotar = useMutation({
    mutationFn: () =>
      api<{ devolucion: DevolucionDetalle }>(
        'POST',
        `/devoluciones/${devolucion.id}/transferencia`,
        { cuerpo: { referencia: referencia.trim() } },
      ),
    onSuccess: async ({ devolucion: anotada }) => {
      setReferencia('');
      await Promise.all([
        consultas.invalidateQueries({ queryKey: ['devoluciones'] }),
        consultas.invalidateQueries({ queryKey: ['alertas'] }),
      ]);
      alAnotar?.(anotada);
    },
  });

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(evento) => {
        evento.preventDefault();
        anotar.mutate();
      }}
    >
      <div className="flex-1">
        <Campo
          etiqueta={`Referencia de la transferencia de ${devolucion.numero ?? `n.º ${devolucion.id}`}`}
          name={`referencia-${devolucion.id}`}
          autoComplete="off"
          maxLength={60}
          placeholder="BAC-778899"
          value={referencia}
          onChange={(evento) => {
            anotar.reset();
            setReferencia(evento.target.value);
          }}
        />
      </div>
      <Boton
        type="submit"
        variante="secundario"
        ocupado={anotar.isPending}
        disabled={referencia.trim().length < 3}
      >
        Anotar la transferencia
      </Boton>
      {anotar.isError && <Aviso tipo="error">{detalleDeError(anotar.error)}</Aviso>}
    </form>
  );
}
