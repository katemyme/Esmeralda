import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Minus, Plus, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, detalleDeError } from '../api/cliente';
import type {
  DevolucionDetalle,
  LineaDevoluble,
  VentaParaDevolver,
  VentasRecientes,
} from '../api/tipos';
import { EtiquetaDeEstado, enlaceVolver, nombreDeTipo } from '../devoluciones/presentacion';
import {
  lineasDeSolicitud,
  montoAproximado,
  numeroDeFactura,
  pedir,
  pendienteDeSolicitud,
  seDevuelve,
  type Pedidos,
} from '../devoluciones/solicitud';
import { EscanerCamara } from '../equipo/EscanerCamara';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta } from '../ui/basicos';
import { deCentavos } from '../util/dinero';
import {
  formatoDia,
  formatoFechaHora,
  formatoHora,
  formatoMonto,
  hoyEnManagua,
  nombreDeDia,
  primerNombre,
  sumarDias,
} from '../util/formato';
import { useRetrasado } from '../util/retrasado';

// Solicitar una devolución o un cambio. Primero se busca la factura: escaneando el QR del ticket
// o escribiendo su número (escanear nunca es el único camino). Qué se puede devolver, cuánto vale
// y hasta cuándo lo dice la base; la pantalla solo arma la solicitud.

const botonRedondo =
  'flex size-12 shrink-0 items-center justify-center rounded-xl border border-borde bg-superficie active:bg-esmeralda-claro disabled:opacity-40';

// ---------------------------------------------------------------------------- Sin el ticket

/**
 * «No tiene el ticket»: las ventas de los últimos días (el plazo de devolución) para elegir la
 * factura. Solo en el equipo de la sucursal: la encargada y el administrador ven todas; la
 * vendedora, las suyas. Cada venta con su monto, nunca una suma.
 */
function SinTicket() {
  const hoy = hoyEnManagua();
  const [abierto, setAbierto] = useState(false);
  const [dia, setDia] = useState(hoy);
  const [texto, setTexto] = useState('');
  const buscado = useRetrasado(texto.trim());
  const lista = useQuery({
    queryKey: ['devoluciones', 'ventas-recientes', dia, buscado],
    queryFn: () =>
      api<VentasRecientes>(
        'GET',
        `/devoluciones/ventas-recientes?limite=200&fecha=${dia}${buscado && `&buscar=${encodeURIComponent(buscado)}`}`,
      ),
    enabled: abierto,
  });
  const dias = lista.data?.dias ?? 0;

  if (!abierto) {
    return (
      <Boton variante="secundario" onClick={() => setAbierto(true)}>
        No tiene el ticket
      </Boton>
    );
  }
  return (
    <Tarjeta className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">No tiene el ticket</h2>
      <p className="text-texto-secundario">
        Busque la venta por el día en que se hizo
        {dias > 0 && `: se puede devolver lo vendido en los últimos ${dias} días`}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Selector
          etiqueta="Día de la venta"
          name="dia"
          value={dia}
          onChange={(evento) => setDia(evento.target.value)}
        >
          {Array.from({ length: dias + 1 }, (_, i) => sumarDias(hoy, -i)).map((d) => (
            <option key={d} value={d}>
              {nombreDeDia(d, hoy)}
            </option>
          ))}
        </Selector>
        <Campo
          etiqueta="Número de factura o cliente (opcional)"
          name="buscar-venta"
          type="search"
          autoComplete="off"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
        />
      </div>
      {lista.isPending && <Cargando texto="Buscando las ventas…" />}
      {lista.isError && <Aviso tipo="error">{detalleDeError(lista.error)}</Aviso>}
      {lista.data?.ventas.length === 0 && (
        <p className="py-4 text-center text-texto-secundario">No hay ventas de ese día.</p>
      )}
      <ul className="divide-y divide-borde">
        {lista.data?.ventas.map((venta) => (
          <li key={venta.id}>
            <Link
              to={`/devoluciones/factura/${venta.numero}`}
              className="flex items-center justify-between gap-3 py-3 active:bg-esmeralda-claro"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {venta.numero}
                  {/* En esta lista lo único que impide devolver es que su caja siga abierta */}
                  {venta.motivo_no && <Etiqueta tono="aviso">Caja abierta: se anula</Etiqueta>}
                </span>
                <span className="block text-sm text-texto-secundario">
                  {formatoHora(venta.fecha)} · {primerNombre(venta.vendedor)}
                  {venta.cliente_nombre && ` · ${venta.cliente_nombre}`}
                </span>
                <span className="block text-sm text-texto-secundario">
                  {venta.productos.join(', ')}
                  {venta.articulos > venta.productos.length &&
                    ` y ${venta.articulos - venta.productos.length} más`}
                </span>
              </span>
              <span className="flex items-center gap-1 font-semibold whitespace-nowrap">
                {formatoMonto(venta.total)}
                <ChevronRight className="size-5 text-texto-secundario" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------- Buscar la factura

export function DevolucionNueva() {
  const sesion = useSesionActiva();
  const navegar = useNavigate();
  const [texto, setTexto] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Con una sola sucursal posible, basta escribir el correlativo: «12» es LAM-00000012
  const codigo =
    sesion.equipo?.sucursal.codigo ??
    (sesion.usuario.sucursales.length === 1 ? sesion.usuario.sucursales[0].codigo : null);

  const abrir = (leido: string) => {
    const numero = numeroDeFactura(leido, codigo);
    if (numero === null) {
      setError('Eso no es un número de factura. Está en el ticket, por ejemplo LAM-00000012.');
      return;
    }
    void navegar(`/devoluciones/factura/${numero}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link to="/devoluciones" className={enlaceVolver}>
        <ArrowLeft className="size-5" aria-hidden /> Devoluciones
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">Nueva solicitud</h1>
        <p className="text-texto-secundario">
          Busque la factura de lo que el cliente quiere devolver o cambiar.
        </p>
      </header>

      <Tarjeta className="flex flex-col gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            abrir(texto);
          }}
        >
          <div className="flex-1">
            <Campo
              etiqueta="Número de factura"
              name="numero"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={codigo ? `${codigo}-12` : 'LAM-12'}
              value={texto}
              onChange={(evento) => {
                setTexto(evento.target.value);
                setError(null);
              }}
            />
          </div>
          <Boton
            variante={escaneando ? 'primario' : 'secundario'}
            aria-pressed={escaneando}
            onClick={() => setEscaneando(!escaneando)}
          >
            <ScanLine className="size-5" aria-hidden />
            <span className="hidden sm:inline">{escaneando ? 'Cerrar cámara' : 'Escanear'}</span>
            <span className="sr-only sm:hidden">{escaneando ? 'Cerrar cámara' : 'Escanear'}</span>
          </Boton>
        </form>
        {/* Fuera del campo: así el botón de escanear queda a la altura de la casilla */}
        <p className="text-sm text-texto-secundario">
          {codigo
            ? `Está en el ticket. Puede escribirlo corto: ${codigo.toLowerCase()}-12 o solo 12.`
            : 'Está en el ticket. Puede escribirlo corto: lam-12.'}
        </p>
        {escaneando && (
          <>
            <p className="text-sm text-texto-secundario">Apunte al código QR del ticket.</p>
            <EscanerCamara
              alLeer={(leido) => {
                setEscaneando(false);
                setTexto(leido);
                abrir(leido);
              }}
            />
          </>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Boton disabled={!texto.trim()} onClick={() => abrir(texto)}>
          Buscar la factura
        </Boton>
      </Tarjeta>

      {sesion.acceso === 'COMPLETO' ? (
        <SinTicket />
      ) : (
        <p className="text-center text-sm text-texto-secundario">
          ¿No tiene el ticket? La venta se busca por su día en el equipo de la sucursal.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- La solicitud

function Contador({
  etiqueta,
  cantidad,
  maximo,
  alCambiar,
}: {
  etiqueta: string;
  cantidad: number;
  maximo: number;
  alCambiar: (cantidad: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={botonRedondo}
        aria-label={`Una menos de ${etiqueta}`}
        disabled={cantidad === 0}
        onClick={() => alCambiar(cantidad - 1)}
      >
        <Minus className="size-5" aria-hidden />
      </button>
      <span
        className="w-10 text-center text-lg font-semibold"
        aria-label={`Cantidad de ${etiqueta}`}
      >
        {cantidad}
      </span>
      <button
        type="button"
        className={botonRedondo}
        aria-label={`Una más de ${etiqueta}`}
        disabled={cantidad >= maximo}
        onClick={() => alCambiar(cantidad + 1)}
      >
        <Plus className="size-5" aria-hidden />
      </button>
    </div>
  );
}

/** Una línea de la factura: cuántas devuelve y en qué estado; o por qué no se puede. */
function Linea({
  linea,
  pedidos,
  alPedir,
}: {
  linea: LineaDevoluble;
  pedidos: Pedidos;
  alPedir: (pedidos: Pedidos) => void;
}) {
  const nombre = linea.variante.nombre;
  const pedido = pedidos[linea.detalle_id] ?? { cantidad: 0, defectuosas: 0 };
  if (!seDevuelve(linea)) {
    return (
      <li className="py-3 text-texto-secundario">
        <p className="font-medium">
          {linea.cantidad} × {nombre}
        </p>
        <p className="text-sm">{linea.motivo_no}</p>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{nombre}</p>
          <p className="text-sm text-texto-secundario">
            {linea.disponible === 1 ? 'Queda 1' : `Quedan ${linea.disponible}`} por devolver ·{' '}
            {formatoMonto(linea.monto_unitario)} c/u
          </p>
        </div>
        <Contador
          etiqueta={nombre}
          cantidad={pedido.cantidad}
          maximo={linea.disponible}
          alCambiar={(cantidad) => alPedir(pedir(pedidos, linea, { cantidad }))}
        />
      </div>
      {pedido.cantidad === 1 && (
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">Estado de {nombre}</legend>
          {[
            { defectuosas: 0, texto: 'En buen estado' },
            { defectuosas: 1, texto: 'Defectuoso' },
          ].map((opcion) => (
            <button
              key={opcion.texto}
              type="button"
              aria-pressed={pedido.defectuosas === opcion.defectuosas}
              onClick={() => alPedir(pedir(pedidos, linea, { defectuosas: opcion.defectuosas }))}
              className={`min-h-toque flex-1 rounded-xl border px-3 font-semibold ${pedido.defectuosas === opcion.defectuosas ? 'border-esmeralda bg-esmeralda-claro text-esmeralda' : 'border-borde bg-superficie text-texto-secundario'}`}
            >
              {opcion.texto}
            </button>
          ))}
        </fieldset>
      )}
      {pedido.cantidad > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">De esas, ¿cuántas están defectuosas?</p>
          <Contador
            etiqueta={`${nombre} defectuosas`}
            cantidad={pedido.defectuosas}
            maximo={pedido.cantidad}
            alCambiar={(defectuosas) => alPedir(pedir(pedidos, linea, { defectuosas }))}
          />
        </div>
      )}
    </li>
  );
}

function Solicitud({ venta }: { venta: VentaParaDevolver }) {
  const sesion = useSesionActiva();
  const navegar = useNavigate();
  const consultas = useQueryClient();
  const [tipo, setTipo] = useState<'DEVOLUCION' | 'CAMBIO' | null>(null);
  const [pedidos, setPedidos] = useState<Pedidos>({});
  const [motivo, setMotivo] = useState('');
  const [nombre, setNombre] = useState(venta.cliente_nombre ?? '');
  const [telefono, setTelefono] = useState(venta.cliente_telefono ?? '');
  const [sucursalId, setSucursalId] = useState<number | null>(null);
  // Sin equipo, la sucursal que solicita es la de la venta si trabaja en ella o su única sucursal;
  // quien trabaja en varias y atiende una factura de otra tiene que decir dónde está el cliente
  const propias = sesion.usuario.sucursales;
  const pideSucursal =
    sesion.equipo === null &&
    propias.length > 1 &&
    !propias.some((s) => s.id === venta.sucursal.id);
  const pendiente = pendienteDeSolicitud({
    tipo,
    pedidos,
    motivo,
    nombre,
    telefono,
    pideSucursal,
    sucursalId,
  });
  const monto = montoAproximado(venta, pedidos);

  const enviar = useMutation({
    mutationFn: () =>
      api<{ devolucion: DevolucionDetalle }>('POST', '/devoluciones', {
        cuerpo: {
          venta_id: venta.id,
          tipo,
          motivo: motivo.trim(),
          cliente_nombre: nombre.trim(),
          cliente_telefono: telefono.trim(),
          lineas: lineasDeSolicitud(pedidos),
          ...(pideSucursal && sucursalId !== null ? { sucursal_id: sucursalId } : {}),
        },
      }),
    onSuccess: async ({ devolucion }) => {
      await consultas.invalidateQueries({ queryKey: ['devoluciones'] });
      await navegar(`/devoluciones/${devolucion.id}`, { state: { enviada: true } });
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (pendiente === null) enviar.mutate();
      }}
    >
      <Tarjeta className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">¿Qué pide el cliente?</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['DEVOLUCION', 'Devolución', 'Se le regresa lo que pagó.'],
              ['CAMBIO', 'Cambio', 'Se lleva otra cosa por ese valor.'],
            ] as const
          ).map(([valor, titulo, detalle]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={tipo === valor}
              onClick={() => setTipo(valor)}
              className={`min-h-toque rounded-xl border px-4 py-3 text-left ${tipo === valor ? 'border-esmeralda bg-esmeralda-claro' : 'border-borde bg-superficie'}`}
            >
              <span className="block font-semibold">{titulo}</span>
              <span className="block text-sm text-texto-secundario">{detalle}</span>
            </button>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta>
        <h2 className="text-lg font-semibold">¿Qué devuelve?</h2>
        <ul className="divide-y divide-borde">
          {venta.lineas.map((linea) => (
            <Linea key={linea.detalle_id} linea={linea} pedidos={pedidos} alPedir={setPedidos} />
          ))}
        </ul>
        {monto > 0 && (
          <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-3">
            <span>Monto de esta solicitud (aprox.)</span>
            <span className="text-xl font-semibold">{formatoMonto(deCentavos(monto))}</span>
          </p>
        )}
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Motivo y cliente</h2>
        <Campo
          etiqueta="Motivo"
          name="motivo"
          maxLength={300}
          placeholder="No le quedó, salió con un defecto…"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Nombre del cliente"
            name="cliente_nombre"
            maxLength={120}
            autoComplete="off"
            value={nombre}
            onChange={(evento) => setNombre(evento.target.value)}
          />
          <Campo
            etiqueta="Teléfono del cliente"
            name="cliente_telefono"
            inputMode="tel"
            maxLength={20}
            autoComplete="off"
            value={telefono}
            onChange={(evento) => setTelefono(evento.target.value)}
          />
        </div>
        {pideSucursal && (
          <Selector
            etiqueta="Sucursal donde está el cliente"
            name="sucursal"
            value={sucursalId ?? ''}
            onChange={(evento) =>
              setSucursalId(evento.target.value ? Number(evento.target.value) : null)
            }
          >
            <option value="">Elija…</option>
            {propias.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
        )}
      </Tarjeta>

      {pendiente !== null && <p className="text-center text-texto-secundario">{pendiente}</p>}
      {enviar.isError && <Aviso tipo="error">{detalleDeError(enviar.error)}</Aviso>}
      <Boton type="submit" ocupado={enviar.isPending} disabled={pendiente !== null}>
        Enviar la solicitud
      </Boton>
      <p className="text-center text-sm text-texto-secundario">
        Queda esperando la aprobación del administrador.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------- La factura

/** La factura encontrada: qué se puede devolver de ella, sus solicitudes y la solicitud nueva. */
export function FacturaParaDevolver() {
  const sesion = useSesionActiva();
  const numero = useParams().numero ?? '';
  const consulta = useQuery({
    queryKey: ['devoluciones', 'venta', numero],
    queryFn: () =>
      api<{ venta: VentaParaDevolver }>(
        'GET',
        `/devoluciones/venta?numero=${encodeURIComponent(numero)}`,
      ),
    retry: false,
    // Siempre recién pedida: lo que se puede devolver cambia cuando se cierra la caja de la venta o
    // cuando otra persona solicita o cancela, y aquí no vale mostrar lo de hace un momento
    staleTime: 0,
    gcTime: 0,
  });
  const venta = consulta.data?.venta;
  const solicita = tienePermiso(sesion, ['DEVOLUCIONES_REGISTRAR']);
  const quedaAlgo = venta?.lineas.some(seDevuelve) ?? false;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link to={solicita ? '/devoluciones/nueva' : '/devoluciones'} className={enlaceVolver}>
        <ArrowLeft className="size-5" aria-hidden />{' '}
        {solicita ? 'Buscar otra factura' : 'Devoluciones'}
      </Link>
      {consulta.isPending && <Cargando texto="Buscando la factura…" />}
      {consulta.isError && <Aviso tipo="error">{detalleDeError(consulta.error)}</Aviso>}
      {venta && (
        <>
          <header>
            <h1 className="text-2xl font-semibold">Factura {venta.numero}</h1>
            <p className="text-texto-secundario">
              {formatoFechaHora(venta.fecha)} · {venta.sucursal.nombre} · Atendió {venta.vendedor}
            </p>
            <p className="text-texto-secundario">
              Total de la factura: {formatoMonto(venta.total)}
            </p>
          </header>

          {venta.motivo_no ? (
            <Aviso tipo="aviso">
              <p className="font-semibold">Esta factura no se puede devolver.</p>
              <p className="font-normal">{venta.motivo_no}.</p>
            </Aviso>
          ) : (
            <p className="text-texto-secundario">
              Se puede devolver hasta el {formatoDia(venta.limite)}.
            </p>
          )}

          {venta.solicitudes.length > 0 && (
            <Tarjeta>
              <h2 className="text-lg font-semibold">Solicitudes de esta factura</h2>
              <ul className="divide-y divide-borde">
                {venta.solicitudes.map((solicitud) => (
                  <li key={solicitud.id}>
                    <Link
                      to={`/devoluciones/${solicitud.id}`}
                      className="flex items-center justify-between gap-3 py-3 active:bg-esmeralda-claro"
                    >
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {nombreDeTipo(solicitud.tipo)} n.º {solicitud.id}
                        <EtiquetaDeEstado devolucion={solicitud} />
                      </span>
                      <span className="flex items-center gap-1 font-semibold whitespace-nowrap">
                        {formatoMonto(solicitud.monto_total)}
                        <ChevronRight className="size-5 text-texto-secundario" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {venta.motivo_no === null && solicita && quedaAlgo && <Solicitud venta={venta} />}
          {venta.motivo_no === null && !quedaAlgo && (
            <Tarjeta>
              <h2 className="text-lg font-semibold">No queda nada por devolver</h2>
              <ul className="divide-y divide-borde">
                {venta.lineas.map((linea) => (
                  <li key={linea.detalle_id} className="py-3 text-texto-secundario">
                    <p className="font-medium">
                      {linea.cantidad} × {linea.variante.nombre}
                    </p>
                    <p className="text-sm">{linea.motivo_no}</p>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </>
      )}
    </div>
  );
}
