import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { api, mensajeDeError } from '../api/cliente';
import { useRutaAlertas } from '../api/consultas';
import type { Alerta, ListaAlertas } from '../api/tipos';
import { Aviso, Boton, Cargando, Etiqueta, Tarjeta } from '../ui/basicos';
import { formatoFechaHora } from '../util/formato';

/**
 * Cómo se llama cada tipo de alerta y de qué color va su etiqueta. Regla del tema: lo de dinero
 * (diferencias de caja, devoluciones, tipo de cambio) y lo de seguridad van en ámbar; lo de
 * inventario, en azul. Ninguna alerta va en rojo: el rojo es para errores, anulaciones y rechazos.
 */
const TIPOS: Record<string, { nombre: string; tono: 'aviso' | 'info' }> = {
  CAJA_DIFERENCIA: { nombre: 'Diferencia de caja', tono: 'aviso' },
  CAJA_DIFERENCIA_APERTURA: { nombre: 'Diferencia al abrir la caja', tono: 'aviso' },
  CAJA_SIN_CERRAR: { nombre: 'Caja sin cerrar', tono: 'aviso' },
  DEVOLUCION_PENDIENTE: { nombre: 'Devolución por aprobar', tono: 'aviso' },
  DEVOLUCION_VENCIDA: { nombre: 'Devolución vencida', tono: 'aviso' },
  DEVOLUCION_TRANSFERENCIA: { nombre: 'Transferencia pendiente', tono: 'aviso' },
  TIPO_CAMBIO_FUERA_LIMITE: { nombre: 'Tipo de cambio', tono: 'aviso' },
  SESION_REUTILIZADA: { nombre: 'Seguridad', tono: 'aviso' },
  PIN_BLOQUEADO: { nombre: 'PIN bloqueado', tono: 'aviso' },
  MARGEN_BAJO: { nombre: 'Margen bajo', tono: 'info' },
  ENVIO_DIFERENCIA: { nombre: 'Diferencia en un envío', tono: 'info' },
  MERMA_PENDIENTE: { nombre: 'Merma por aprobar', tono: 'info' },
  CONTEO_PENDIENTE: { nombre: 'Conteo por aplicar', tono: 'info' },
};

function tipoDe(alerta: Alerta) {
  return (
    TIPOS[alerta.tipo] ?? {
      nombre: alerta.tipo.replaceAll('_', ' ').toLowerCase(),
      tono: 'info' as const,
    }
  );
}

/**
 * Centro de alertas. El administrador ve las del panel; los demás, los avisos de su sucursal.
 * Cada quien atiende las suyas: marcar un aviso como visto no toca la alerta del administrador.
 */
export function Alertas() {
  const ruta = useRutaAlertas();
  const delPanel = ruta === '/alertas';
  const consultas = useQueryClient();
  const [estado, setEstado] = useState<'pendientes' | 'atendidas'>('pendientes');

  const lista = useQuery({
    queryKey: ['alertas', ruta, estado],
    queryFn: () => api<ListaAlertas>('GET', `${ruta}?estado=${estado}&limite=100`),
    refetchInterval: 60_000,
  });
  const atender = useMutation({
    mutationFn: (id: number) => api<{ alerta: Alerta }>('POST', `/alertas/${id}/atender`),
    onSuccess: () => consultas.invalidateQueries({ queryKey: ['alertas'] }),
  });

  const pestana = (valor: typeof estado, texto: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={estado === valor}
      onClick={() => setEstado(valor)}
      className={`min-h-toque flex-1 rounded-xl px-4 font-semibold ${estado === valor ? 'bg-esmeralda text-white' : 'text-texto-secundario'}`}
    >
      {texto}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">{delPanel ? 'Alertas' : 'Avisos de mi sucursal'}</h1>
        <p className="text-texto-secundario">
          {delPanel
            ? 'Lo que el sistema quiere que revise.'
            : 'Lo que su sucursal tiene que saber. Márquelo como visto cuando ya esté enterada.'}
        </p>
      </header>

      <div role="tablist" className="flex gap-1 rounded-2xl border border-borde bg-superficie p-1">
        {pestana('pendientes', 'Pendientes')}
        {pestana('atendidas', delPanel ? 'Atendidas' : 'Vistas')}
      </div>

      {atender.isError && <Aviso tipo="error">{mensajeDeError(atender.error)}</Aviso>}
      {lista.isPending && <Cargando />}
      {lista.isError && <Aviso tipo="error">{mensajeDeError(lista.error)}</Aviso>}
      {lista.data?.alertas.length === 0 && (
        <Tarjeta className="flex flex-col items-center gap-2 py-10 text-center text-texto-secundario">
          <CircleCheck className="size-10 text-exito" aria-hidden />
          {estado === 'pendientes' ? 'No hay nada pendiente.' : 'Todavía no hay ninguna.'}
        </Tarjeta>
      )}

      <ul className="flex flex-col gap-3">
        {lista.data?.alertas.map((alerta) => {
          const tipo = tipoDe(alerta);
          return (
            <li key={alerta.id}>
              <Tarjeta className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Etiqueta tono={tipo.tono}>{tipo.nombre}</Etiqueta>
                    {alerta.sucursal && <Etiqueta>{alerta.sucursal.nombre}</Etiqueta>}
                  </div>
                  <p className="mt-2 font-medium">{alerta.titulo}</p>
                  <p className="text-sm text-texto-secundario">
                    {formatoFechaHora(alerta.creada_at)}
                    {alerta.atendida_por &&
                      alerta.atendida_at &&
                      ` · ${delPanel ? 'Atendida' : 'Vista'} por ${alerta.atendida_por.nombre_completo}`}
                  </p>
                </div>
                {!alerta.atendida_at && (
                  <Boton
                    variante="secundario"
                    ocupado={atender.isPending && atender.variables === alerta.id}
                    onClick={() => atender.mutate(alerta.id)}
                  >
                    {delPanel ? 'Atender' : 'Marcar como vista'}
                  </Boton>
                )}
              </Tarjeta>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
