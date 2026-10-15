import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, detalleDeError } from '../api/cliente';
import { usePorTransferir } from '../api/consultas';
import type { DevolucionResumen, Parametro } from '../api/tipos';
import { numeroDeWhatsapp } from '../devoluciones/aviso';
import { EtiquetaDeEstado, nombreDeTipo } from '../devoluciones/presentacion';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Tarjeta } from '../ui/basicos';
import { formatoDia, formatoFechaHora, formatoMonto, primerNombre } from '../util/formato';
import { useRetrasado } from '../util/retrasado';

// Devoluciones y cambios de ventas de turnos ya cerrados. La sucursal solicita, el administrador
// aprueba o rechaza, y la aprobada se ejecuta en caja. El arqueo es a ciegas: cada devolución
// muestra su monto (hay que poder entregarlo), pero aquí nunca se suman.

const PAGINA = 50;
const TOPE = 200; // lo más que entrega la API de una vez

type Pestana = { estado: string; titulo: string; vacia: string };

const POR_APROBAR: Pestana = {
  estado: 'PENDIENTE',
  titulo: 'Por aprobar',
  vacia: 'No hay ninguna por aprobar.',
};
const ESPERANDO: Pestana = {
  estado: 'PENDIENTE',
  titulo: 'Esperando aprobación',
  vacia: 'No hay ninguna esperando aprobación.',
};
const APROBADAS: Pestana = {
  estado: 'APROBADA',
  titulo: 'Aprobadas',
  vacia: 'No hay ninguna aprobada por ejecutar.',
};
const TODAS: Pestana = { estado: '', titulo: 'Todas', vacia: 'Todavía no hay ninguna.' };

function Fila({ devolucion }: { devolucion: DevolucionResumen }) {
  return (
    <Link
      to={`/devoluciones/${devolucion.id}`}
      className="block rounded-2xl focus-visible:outline-offset-4"
    >
      <Tarjeta className="flex items-center justify-between gap-3 active:bg-esmeralda-claro">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 font-semibold">
            {nombreDeTipo(devolucion.tipo)} · {devolucion.venta.numero}
            <EtiquetaDeEstado devolucion={devolucion} />
            {devolucion.por_transferir && <Etiqueta tono="aviso">Falta la transferencia</Etiqueta>}
          </span>
          <span className="block text-sm text-texto-secundario">
            {devolucion.cliente_nombre} · {formatoFechaHora(devolucion.solicitada_at)} ·{' '}
            {primerNombre(devolucion.solicitada_por.nombre_completo)}
          </span>
          <span className="block text-sm text-texto-secundario">
            {devolucion.sucursal_solicitud.nombre}
            {devolucion.estado === 'APROBADA' &&
              devolucion.vence_el &&
              ` · Vence el ${formatoDia(devolucion.vence_el)}`}
          </span>
        </span>
        <span className="flex items-center gap-1 font-semibold whitespace-nowrap">
          {formatoMonto(devolucion.monto_total)}
          <ChevronRight className="size-5 text-texto-secundario" aria-hidden />
        </span>
      </Tarjeta>
    </Link>
  );
}

const CLAVE_WHATSAPP = 'WHATSAPP_ADMINISTRADOR';

/**
 * El número de WhatsApp del administrador: con él, quien solicita una devolución puede avisarle
 * con un toque. Los demás parámetros se cambian en la pantalla de administración (F4).
 */
function NumeroDeAviso() {
  const consultas = useQueryClient();
  const parametros = useQuery({
    queryKey: ['parametros'],
    queryFn: () => api<{ parametros: Parametro[] }>('GET', '/parametros'),
  });
  const guardado = parametros.data?.parametros.find((p) => p.clave === CLAVE_WHATSAPP)?.valor ?? '';
  const [escrito, setEscrito] = useState<string | null>(null); // null: todavía no lo toca
  const texto = escrito ?? guardado;
  const numero = numeroDeWhatsapp(texto);
  const guardar = useMutation({
    mutationFn: () =>
      api<{ parametro: Parametro }>('PUT', `/parametros/${CLAVE_WHATSAPP}`, {
        cuerpo: { valor: numero || null },
      }),
    onSuccess: async () => {
      setEscrito(null);
      await consultas.invalidateQueries({ queryKey: ['parametros'] });
      await consultas.invalidateQueries({ queryKey: ['devoluciones'] });
    },
  });

  if (parametros.isPending) return null;
  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Aviso por WhatsApp</h2>
      <p className="text-texto-secundario">
        Con su número, quien solicita una devolución puede avisarle por WhatsApp con un toque. El
        mensaje lleva el número de la solicitud, la factura, el monto y la sucursal. Sin número, el
        botón no sale.
      </p>
      {parametros.isError && <Aviso tipo="error">{detalleDeError(parametros.error)}</Aviso>}
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (numero !== null) guardar.mutate();
        }}
      >
        <div className="flex-1">
          <Campo
            etiqueta="Su número de WhatsApp, con el código del país"
            name="whatsapp"
            inputMode="tel"
            autoComplete="off"
            placeholder="505 8888 7777"
            value={texto}
            onChange={(evento) => {
              guardar.reset();
              setEscrito(evento.target.value);
            }}
            error={
              numero === null
                ? 'Escriba el número con el código del país, por ejemplo 505 8888 7777.'
                : undefined
            }
          />
        </div>
        <Boton
          type="submit"
          variante="secundario"
          ocupado={guardar.isPending}
          disabled={numero === null || escrito === null}
        >
          Guardar el número
        </Boton>
      </form>
      {guardar.isError && <Aviso tipo="error">{detalleDeError(guardar.error)}</Aviso>}
      {guardar.isSuccess && (
        <Aviso tipo="exito">
          {guardado ? 'Número guardado.' : 'Quedó sin número: el botón de aviso no sale.'}
        </Aviso>
      )}
    </Tarjeta>
  );
}

export function Devoluciones() {
  const sesion = useSesionActiva();
  const aprueba = tienePermiso(sesion, ['DEVOLUCIONES_APROBAR']);
  const transferencias = usePorTransferir();
  const pestanas = aprueba ? [POR_APROBAR, APROBADAS, TODAS] : [APROBADAS, ESPERANDO, TODAS];
  const [elegida, setElegida] = useState(0);
  const [texto, setTexto] = useState('');
  const [limite, setLimite] = useState(PAGINA);
  const buscado = useRetrasado(texto.trim());
  const pestana = pestanas[elegida];

  const lista = useQuery({
    queryKey: ['devoluciones', 'lista', pestana.estado, buscado, limite],
    queryFn: () =>
      api<{ devoluciones: DevolucionResumen[] }>(
        'GET',
        `/devoluciones?limite=${limite}${pestana.estado && `&estado=${pestana.estado}`}${buscado && `&buscar=${encodeURIComponent(buscado)}`}`,
      ),
    refetchInterval: 60_000,
  });
  const devoluciones = lista.data?.devoluciones ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Devoluciones y cambios</h1>
        {tienePermiso(sesion, ['DEVOLUCIONES_REGISTRAR']) && (
          <Link
            to="/devoluciones/nueva"
            className="inline-flex min-h-toque items-center justify-center gap-2 rounded-xl bg-esmeralda px-5 font-semibold text-white hover:bg-esmeralda-oscuro"
          >
            <Plus className="size-5" aria-hidden /> Nueva solicitud
          </Link>
        )}
      </header>

      {transferencias !== null && (
        <Link
          to="/devoluciones/transferencias"
          className="flex min-h-toque items-center justify-between gap-3 rounded-2xl border border-borde bg-superficie px-4 font-semibold active:bg-esmeralda-claro"
        >
          <span className="flex items-center gap-2">
            <Banknote className="size-5 text-esmeralda" aria-hidden /> Transferencias pendientes
          </span>
          {transferencias > 0 ? (
            <Etiqueta tono="aviso">{transferencias} por hacer</Etiqueta>
          ) : (
            <span className="text-sm font-normal text-texto-secundario">Ninguna</span>
          )}
        </Link>
      )}

      <div role="tablist" className="flex gap-1 rounded-2xl border border-borde bg-superficie p-1">
        {pestanas.map((p, i) => (
          <button
            key={p.titulo}
            type="button"
            role="tab"
            aria-selected={elegida === i}
            onClick={() => {
              setElegida(i);
              setLimite(PAGINA);
            }}
            className={`min-h-toque flex-1 rounded-xl px-2 text-sm font-semibold sm:text-base ${elegida === i ? 'bg-esmeralda text-white' : 'text-texto-secundario'}`}
          >
            {p.titulo}
          </button>
        ))}
      </div>

      <Campo
        etiqueta="Buscar por factura, número de devolución o cliente"
        name="buscar"
        type="search"
        autoComplete="off"
        value={texto}
        onChange={(evento) => {
          setTexto(evento.target.value);
          setLimite(PAGINA);
        }}
      />

      {lista.isPending && <Cargando />}
      {lista.isError && <Aviso tipo="error">{detalleDeError(lista.error)}</Aviso>}
      {lista.isSuccess && devoluciones.length === 0 && (
        <Tarjeta className="text-center text-texto-secundario">
          {buscado ? `No hay ninguna con «${buscado}».` : pestana.vacia}
        </Tarjeta>
      )}

      <ul className="flex flex-col gap-3">
        {devoluciones.map((devolucion) => (
          <li key={devolucion.id}>
            <Fila devolucion={devolucion} />
          </li>
        ))}
      </ul>
      {devoluciones.length === limite && limite < TOPE && (
        <Boton
          variante="secundario"
          ocupado={lista.isFetching}
          onClick={() => setLimite(Math.min(limite + PAGINA, TOPE))}
        >
          Ver más
        </Boton>
      )}

      {tienePermiso(sesion, ['PARAMETROS_GESTIONAR']) && <NumeroDeAviso />}
    </div>
  );
}
