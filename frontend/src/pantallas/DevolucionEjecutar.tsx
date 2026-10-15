import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorApi, api, detalleDeError } from '../api/cliente';
import { useTipoCambio } from '../api/consultas';
import type { DevolucionDetalle, MetodoPago, RepartoEjecucion, VentaDetalle } from '../api/tipos';
import {
  cuentaDelCambio,
  estadosCambiados,
  estadosIniciales,
  type Estado,
} from '../devoluciones/ejecucion';
import { enlaceVolver, nombreDeTipo } from '../devoluciones/presentacion';
import { BotonImprimir } from '../equipo/BotonImprimir';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Cargando, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { aCentavos, deCentavos, nuevoUuid } from '../util/dinero';
import { formatoDia, formatoFecha, formatoMonto } from '../util/formato';
import { ArmarVenta, pesos, useArmado } from '../venta/ArmarVenta';
import { itemsDeVenta, nuevoPago, pagosDeVenta, subtotal, type Pago } from '../venta/carrito';
import { Cobro, Fila } from '../venta/Cobro';
import { useDestinoDeVenta, type Destino } from '../venta/destino';

// Ejecutar en caja una devolución o un cambio ya aprobado, en el equipo de la sucursal donde está
// el cliente (puede ser otra que la de la venta), con su turno abierto. Quien atiende revisa en qué
// estado llega cada producto y entrega lo que dice la base: en efectivo de la caja lo que se pagó
// en efectivo; lo pagado con tarjeta o transferencia lo transfiere la administración. En un cambio,
// lo que se lleva el cliente se arma como una venta (sin promoción) y lo devuelto la paga. El
// arqueo es a ciegas: aquí se ve el monto de esta devolución, nunca sumas.

type Listo = Extract<Destino, { estado: 'listo' }>;

const SIN_CONEXION =
  'No hay conexión con el servidor, así que no está confirmado. Revise el internet y toque «Reintentar»: si ya había entrado, no se repite.';

const OPCIONES: { estado: Estado; texto: string }[] = [
  { estado: 'BUENO', texto: 'En buen estado' },
  { estado: 'DEFECTUOSO', texto: 'Defectuoso' },
];

/** Cómo llega cada producto: en buen estado vuelve a las existencias; defectuoso sale como merma. */
function Recibir({
  devolucion,
  elegidos,
  alElegir,
}: {
  devolucion: DevolucionDetalle;
  elegidos: Record<number, Estado>;
  alElegir: (elegidos: Record<number, Estado>) => void;
}) {
  return (
    <Tarjeta className="flex flex-col gap-2">
      <div>
        <h2 className="text-lg font-semibold">Lo que entrega el cliente</h2>
        <p className="text-sm text-texto-secundario">
          Revise cada producto al recibirlo: en buen estado vuelve a las existencias; defectuoso
          sale como merma.
        </p>
      </div>
      <ul className="divide-y divide-borde">
        {devolucion.lineas.map((linea) => {
          const elegido = elegidos[linea.id];
          const nombre = `${linea.cantidad} × ${linea.variante.nombre}`;
          return (
            <li key={linea.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">{nombre}</span>
                <span className="font-semibold whitespace-nowrap">{formatoMonto(linea.monto)}</span>
              </div>
              <fieldset className="flex items-center gap-2">
                <legend className="sr-only">Cómo llega {nombre}</legend>
                {OPCIONES.map((opcion) => (
                  <button
                    key={opcion.estado}
                    type="button"
                    aria-pressed={elegido === opcion.estado}
                    onClick={() => alElegir({ ...elegidos, [linea.id]: opcion.estado })}
                    className={`min-h-toque flex-1 rounded-xl border px-3 font-semibold ${elegido === opcion.estado ? 'border-esmeralda bg-esmeralda-claro text-esmeralda' : 'border-borde bg-superficie text-texto-secundario'}`}
                  >
                    {opcion.texto}
                  </button>
                ))}
              </fieldset>
              {elegido !== linea.estado_producto && (
                <p className="text-sm font-semibold text-aviso">
                  Se pidió{' '}
                  {linea.estado_producto === 'DEFECTUOSO' ? 'como defectuoso' : 'en buen estado'}.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}

/** Lo que se le entrega al cliente: efectivo de la caja y lo que transfiere la administración. */
function Entrega({ efectivo, transferencia }: { efectivo: string; transferencia: string }) {
  return (
    <Tarjeta className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Lo que se le entrega</h2>
      <p className="flex items-baseline justify-between gap-3">
        <span>En efectivo, de la caja</span>
        <span className="text-2xl font-semibold">{formatoMonto(efectivo)}</span>
      </p>
      <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-2">
        <span>Por transferencia (la hace la administración)</span>
        <span className="font-semibold whitespace-nowrap">{formatoMonto(transferencia)}</span>
      </p>
      <p className="text-sm text-texto-secundario">
        Se reparte como se pagó la factura: lo pagado en efectivo sale de la caja; lo pagado con
        tarjeta o transferencia se le transfiere.
      </p>
    </Tarjeta>
  );
}

function ErrorDeEjecucion({ error }: { error: unknown }) {
  if (error instanceof ErrorApi && error.codigo === 'SIN_CONEXION') {
    return <Aviso tipo="error">{SIN_CONEXION}</Aviso>;
  }
  return <Aviso tipo="error">{detalleDeError(error)}</Aviso>;
}

/** POST /ejecutar. Si la respuesta se perdió pero sí se ejecutó, se ve igual que si hubiera llegado. */
function useEjecutar(devolucion: DevolucionDetalle, alHecha: (d: DevolucionDetalle) => void) {
  const consultas = useQueryClient();
  const terminar = async (hecha: DevolucionDetalle) => {
    await Promise.all([
      consultas.invalidateQueries({ queryKey: ['devoluciones'] }),
      consultas.invalidateQueries({ queryKey: ['alertas'] }),
      consultas.invalidateQueries({ queryKey: ['ventas'] }),
      // las existencias cambiaron: lo que entró y, en un cambio, lo que salió
      consultas.invalidateQueries({ queryKey: ['venta', 'buscar'] }),
    ]);
    alHecha(hecha);
  };
  return useMutation({
    mutationFn: (cuerpo: Record<string, unknown>) =>
      api<{ devolucion: DevolucionDetalle; repetida: boolean }>(
        'POST',
        `/devoluciones/${devolucion.id}/ejecutar`,
        { cuerpo },
      ),
    onSuccess: ({ devolucion: hecha }) => terminar(hecha),
    onError: async () => {
      try {
        const actual = await api<{ devolucion: DevolucionDetalle }>(
          'GET',
          `/devoluciones/${devolucion.id}`,
        );
        if (actual.devolucion.estado === 'EJECUTADA') await terminar(actual.devolucion);
      } catch {
        // sin conexión: se queda el error a la vista para reintentar
      }
    },
  });
}

// ---------------------------------------------------------------------------- Devolución

function EjecutarDevolucion({
  devolucion,
  alHecha,
}: {
  devolucion: DevolucionDetalle;
  alHecha: (d: DevolucionDetalle) => void;
}) {
  const [elegidos, setElegidos] = useState(() => estadosIniciales(devolucion.lineas));
  const [confirmar, setConfirmar] = useState(false);
  const ejecutar = useEjecutar(devolucion, alHecha);
  // Lo previsto por la base: el mismo reparto que hará al ejecutarla
  const reembolso = devolucion.reembolso;

  return (
    <>
      <Recibir devolucion={devolucion} elegidos={elegidos} alElegir={setElegidos} />
      {reembolso && (
        <Entrega efectivo={reembolso.efectivo} transferencia={reembolso.transferencia} />
      )}
      {ejecutar.isError && <ErrorDeEjecucion error={ejecutar.error} />}
      <Boton ocupado={ejecutar.isPending} onClick={() => setConfirmar(true)}>
        {ejecutar.error instanceof ErrorApi && ejecutar.error.codigo === 'SIN_CONEXION'
          ? 'Reintentar'
          : 'Ejecutar la devolución'}
      </Boton>
      <Confirmacion
        abierta={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="¿Ejecutar la devolución?"
        textoConfirmar="Sí, ejecutarla"
        ocupado={ejecutar.isPending}
        alConfirmar={() =>
          ejecutar.mutate(
            { lineas: estadosCambiados(devolucion.lineas, elegidos) },
            { onSettled: () => setConfirmar(false) },
          )
        }
      >
        {reembolso && (
          <>
            <span className="block">
              Entregue {formatoMonto(reembolso.efectivo)} en efectivo de la caja.
            </span>
            {Number(reembolso.transferencia) > 0 && (
              <span className="block">
                {formatoMonto(reembolso.transferencia)} se le transfieren: los hace la
                administración.
              </span>
            )}
          </>
        )}
        <span className="block">Sale el ticket para que el cliente lo firme.</span>
      </Confirmacion>
    </>
  );
}

// ---------------------------------------------------------------------------- Cambio

function EjecutarCambio({
  devolucion,
  destino,
  alHecha,
}: {
  devolucion: DevolucionDetalle;
  destino: Listo;
  alHecha: (d: DevolucionDetalle) => void;
}) {
  const sesion = useSesionActiva();
  const tipoCambio = useTipoCambio();
  const armado = useArmado();
  const [elegidos, setElegidos] = useState(() => estadosIniciales(devolucion.lineas));
  const [paso, setPaso] = useState<'armar' | 'cobro'>('armar');
  const [pagos, setPagos] = useState<Pago[]>(() => [nuevoPago('EFECTIVO')]);
  const [confirmar, setConfirmar] = useState(false);
  // La misma clave en cada intento de este cambio: si la respuesta se pierde, reintentar no duplica
  const [clave] = useState(nuevoUuid);
  const ejecutar = useEjecutar(devolucion, alHecha);
  const metodos = useQuery({
    queryKey: ['metodos-pago'],
    queryFn: () => api<{ metodos_pago: MetodoPago[] }>('GET', '/metodos-pago'),
    staleTime: Infinity,
  });

  const devuelto = aCentavos(devolucion.monto_total);
  const nuevo = subtotal(armado.lineas);
  const cuenta = cuentaDelCambio(devuelto, nuevo);
  const armando = armado.lineas.length === 0 || armado.paquete !== null;
  // Lo que sobra se reparte como se pagó la factura: lo calcula la base, para este total
  const reparto = useQuery({
    queryKey: ['devoluciones', 'reparto', devolucion.id, nuevo],
    queryFn: () =>
      api<{ reparto: RepartoEjecucion }>(
        'GET',
        `/devoluciones/${devolucion.id}/reparto?total=${deCentavos(nuevo)}`,
      ),
    enabled: !armando && cuenta.sobrante > 0,
  });
  const cuerpo = (conPagos: boolean) => ({
    clave_idempotencia: clave,
    items: itemsDeVenta(armado.lineas),
    pagos: conPagos ? pagosDeVenta(pagos) : [],
    lineas: estadosCambiados(devolucion.lineas, elegidos),
  });
  const resumen = (
    <Tarjeta className="flex flex-col gap-2">
      <Fila etiqueta="Lo devuelto">{pesos(devuelto)}</Fila>
      <Fila etiqueta="Lo que se lleva">{pesos(nuevo)}</Fila>
    </Tarjeta>
  );

  if (paso === 'cobro') {
    return (
      <Cobro
        total={cuenta.porCobrar}
        pagos={pagos}
        metodos={metodos.data?.metodos_pago ?? []}
        usdANio={tipoCambio?.usd_a_nio ?? null}
        cliente={{ nombre: '', telefono: '' }}
        alCambiarPagos={(nuevos) => {
          ejecutar.reset();
          setPagos(nuevos);
        }}
        alCambiarCliente={() => {}}
        alVolver={() => {
          ejecutar.reset();
          setPaso('armar');
        }}
        alRegistrar={() => ejecutar.mutate(cuerpo(true))}
        registrando={ejecutar.isPending}
        error={ejecutar.error}
        titulo="Cobrar la diferencia"
        etiquetaTotal="Diferencia a cobrar"
        textoRegistrar="Ejecutar el cambio"
        sinConexion={SIN_CONEXION}
        conCliente={false}
        arriba={resumen}
      />
    );
  }

  const listoParaEntregar = cuenta.sobrante === 0 || reparto.isSuccess;
  return (
    <>
      <Recibir devolucion={devolucion} elegidos={elegidos} alElegir={setElegidos} />
      <h2 className="text-lg font-semibold">Lo que se lleva el cliente</h2>
      <ArmarVenta
        armado={armado}
        sucursalId={destino.sucursal.id}
        puedeSubir={tienePermiso(sesion, ['VENTAS_MODIFICAR_PRECIO'])}
        titulo="Lo que se lleva"
        vacia="Busque o escanee lo que se lleva el cliente a cambio. En un cambio no se aplican promociones."
      />

      {!armando && (
        <>
          {resumen}
          {cuenta.porCobrar > 0 ? (
            <Boton onClick={() => setPaso('cobro')}>
              Cobrar la diferencia {pesos(cuenta.porCobrar)}
            </Boton>
          ) : (
            <>
              {cuenta.sobrante === 0 && (
                <Aviso tipo="info">
                  Cuesta lo mismo que lo devuelto: no se cobra ni se entrega nada.
                </Aviso>
              )}
              {cuenta.sobrante > 0 && reparto.isPending && (
                <Cargando texto="Calculando lo que se le entrega…" />
              )}
              {reparto.isError && <Aviso tipo="error">{detalleDeError(reparto.error)}</Aviso>}
              {cuenta.sobrante > 0 && reparto.data && (
                <Entrega
                  efectivo={reparto.data.reparto.efectivo}
                  transferencia={reparto.data.reparto.transferencia}
                />
              )}
              {ejecutar.isError && <ErrorDeEjecucion error={ejecutar.error} />}
              <Boton
                ocupado={ejecutar.isPending}
                disabled={!listoParaEntregar}
                onClick={() => setConfirmar(true)}
              >
                {ejecutar.error instanceof ErrorApi && ejecutar.error.codigo === 'SIN_CONEXION'
                  ? 'Reintentar'
                  : 'Ejecutar el cambio'}
              </Boton>
            </>
          )}
        </>
      )}
      {armado.paquete && (
        <p className="text-sm text-texto-secundario">
          Termine de armar la perforación con pieza, o cancélela, antes de seguir.
        </p>
      )}
      <Confirmacion
        abierta={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="¿Ejecutar el cambio?"
        textoConfirmar="Sí, ejecutarlo"
        ocupado={ejecutar.isPending}
        alConfirmar={() => ejecutar.mutate(cuerpo(false), { onSettled: () => setConfirmar(false) })}
      >
        <span className="block">Se lleva lo que suma {pesos(nuevo)}.</span>
        {cuenta.sobrante > 0 && reparto.data && (
          <span className="block">
            Se le devuelven {pesos(cuenta.sobrante)}: {formatoMonto(reparto.data.reparto.efectivo)}{' '}
            en efectivo de la caja y {formatoMonto(reparto.data.reparto.transferencia)} por
            transferencia.
          </span>
        )}
        <span className="block">Salen el ticket del cambio y la factura nueva.</span>
      </Confirmacion>
    </>
  );
}

// ---------------------------------------------------------------------------- Ya ejecutada

/**
 * Lo que se entrega y los tickets: sale solo el de la devolución (el que firma el cliente y se
 * queda en la tienda) y, en un cambio, después la factura nueva. «Copia para el cliente» sale con
 * la palabra COPIA. Por USB, el original abre la gaveta si sale efectivo de la caja.
 */
function Hecha({ devolucion }: { devolucion: DevolucionDetalle }) {
  const [primeroListo, setPrimeroListo] = useState(false);
  const cambio = devolucion.venta_cambio;
  const venta = useQuery({
    queryKey: ['ventas', 'detalle', cambio?.id],
    queryFn: () => api<{ venta: VentaDetalle }>('GET', `/ventas/${cambio?.id}`),
    enabled: cambio !== null,
  });
  const efectivo = devolucion.reembolso?.efectivo ?? '0.00';
  const transferencia = devolucion.reembolso?.transferencia ?? '0.00';
  const vuelto = Number(venta.data?.venta.vuelto ?? 0);
  const ruta = `/devoluciones/${devolucion.id}/imprimir`;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <Aviso tipo="exito">
        <p className="font-semibold">
          {devolucion.tipo === 'CAMBIO' ? 'Cambio ejecutado' : 'Devolución ejecutada'}
        </p>
        <p className="font-normal">{devolucion.numero}</p>
      </Aviso>

      <Tarjeta className="flex flex-col gap-3">
        {Number(efectivo) > 0 ? (
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-lg">Entregue en efectivo</span>
            <span className="text-3xl font-semibold">{formatoMonto(efectivo)}</span>
          </p>
        ) : (
          <p className="text-texto-secundario">No sale efectivo de la caja.</p>
        )}
        {Number(transferencia) > 0 && (
          <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-3">
            <span>Por transferencia: la hace la administración</span>
            <span className="font-semibold whitespace-nowrap">{formatoMonto(transferencia)}</span>
          </p>
        )}
        {cambio && (
          <>
            <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-3">
              <span>Factura nueva {cambio.numero}</span>
              <span className="font-semibold whitespace-nowrap">{formatoMonto(cambio.total)}</span>
            </p>
            {vuelto > 0 && (
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-lg">Entregue de vuelto</span>
                <span className="text-2xl font-semibold">
                  {formatoMonto(venta.data?.venta.vuelto ?? '0')}
                </span>
              </p>
            )}
          </>
        )}
      </Tarjeta>

      <p className="text-sm text-texto-secundario">
        El ticket de {devolucion.tipo === 'CAMBIO' ? 'el cambio' : 'la devolución'} lo firma el
        cliente y se queda en la tienda.
      </p>
      <BotonImprimir
        ruta={ruta}
        automatico
        texto={
          devolucion.tipo === 'CAMBIO'
            ? 'Imprimir el ticket del cambio'
            : 'Imprimir el ticket de la devolución'
        }
        alTerminar={() => setPrimeroListo(true)}
      />
      {cambio && (
        <BotonImprimir
          ruta={`/ventas/${cambio.id}/imprimir`}
          automatico={primeroListo}
          texto="Imprimir la factura nueva"
          conDialogo={false}
        />
      )}
      <BotonImprimir ruta={ruta} texto="Copia para el cliente" conDialogo={false} />
      <Link
        to={`/devoluciones/${devolucion.id}`}
        className="inline-flex min-h-toque items-center justify-center rounded-xl border border-borde bg-superficie px-5 font-semibold text-texto hover:bg-esmeralda-claro"
      >
        Listo
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------- La pantalla

/** Ya en el equipo: el turno abierto de su caja. */
function EnCaja({
  devolucion,
  alHecha,
}: {
  devolucion: DevolucionDetalle;
  alHecha: (d: DevolucionDetalle) => void;
}) {
  const sesion = useSesionActiva();
  const destino = useDestinoDeVenta(null);
  if (destino.estado === 'cargando') return <Cargando />;
  if (destino.estado === 'error') return <Aviso tipo="error">{destino.mensaje}</Aviso>;
  if (destino.estado !== 'listo') {
    return (
      <Aviso tipo="aviso">
        <p className="font-semibold">La caja está cerrada.</p>
        <p className="font-normal">
          Para ejecutarla hay que abrirla primero: el efectivo sale de la caja del turno.{' '}
          {tienePermiso(sesion, ['CAJA_ABRIR']) && (
            <Link to="/caja" className="font-semibold text-esmeralda underline">
              Ir a la caja
            </Link>
          )}
        </p>
      </Aviso>
    );
  }
  return (
    <>
      <p className="text-texto-secundario">
        Entra en {destino.sucursal.nombre} · {destino.caja.nombre}
      </p>
      {devolucion.tipo === 'CAMBIO' ? (
        <EjecutarCambio
          key={destino.turnoId}
          devolucion={devolucion}
          destino={destino}
          alHecha={alHecha}
        />
      ) : (
        <EjecutarDevolucion key={destino.turnoId} devolucion={devolucion} alHecha={alHecha} />
      )}
    </>
  );
}

export function DevolucionEjecutar() {
  const sesion = useSesionActiva();
  const id = Number(useParams().id);
  const [hecha, setHecha] = useState<DevolucionDetalle | null>(null);
  const consulta = useQuery({
    queryKey: ['devoluciones', 'detalle', id],
    queryFn: () => api<{ devolucion: DevolucionDetalle }>('GET', `/devoluciones/${id}`),
    enabled: Number.isSafeInteger(id) && id > 0,
  });
  const devolucion = consulta.data?.devolucion;

  if (hecha) return <Hecha devolucion={hecha} />;

  let bloqueo: string | null = null;
  if (devolucion) {
    if (devolucion.estado === 'EJECUTADA') {
      bloqueo = `Ya se ejecutó${devolucion.numero ? ` (${devolucion.numero})` : ''}.`;
    } else if (devolucion.estado !== 'APROBADA') {
      bloqueo = 'Solo se ejecuta una solicitud aprobada.';
    } else if (!tienePermiso(sesion, ['DEVOLUCIONES_REGISTRAR'])) {
      bloqueo = 'Su usuario no ejecuta devoluciones.';
    } else if (sesion.equipo === null) {
      bloqueo =
        'Se ejecuta en el equipo de la sucursal donde está el cliente, con la caja abierta: ahí se recibe el producto y sale el dinero.';
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link to={`/devoluciones/${id}`} className={enlaceVolver}>
        <ArrowLeft className="size-5" aria-hidden /> La solicitud
      </Link>
      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{detalleDeError(consulta.error)}</Aviso>}
      {devolucion && (
        <>
          <header>
            <h1 className="text-2xl font-semibold">
              Ejecutar {devolucion.tipo === 'CAMBIO' ? 'el cambio' : 'la devolución'} n.º{' '}
              {devolucion.id}
            </h1>
            <p className="text-texto-secundario">
              {nombreDeTipo(devolucion.tipo)} de la factura {devolucion.venta.numero} del{' '}
              {formatoFecha(devolucion.venta.fecha)} · {devolucion.venta.sucursal.nombre}
            </p>
            <p className="text-texto-secundario">
              {devolucion.cliente_nombre} · {devolucion.cliente_telefono}
              {devolucion.vence_el && ` · Hasta el ${formatoDia(devolucion.vence_el)}`}
            </p>
          </header>
          {bloqueo ? (
            <Aviso tipo="info">{bloqueo}</Aviso>
          ) : (
            <EnCaja devolucion={devolucion} alHecha={setHecha} />
          )}
        </>
      )}
    </div>
  );
}
