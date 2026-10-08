import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Minus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorApi, api, detalleDeError } from '../api/cliente';
import { useTipoCambio } from '../api/consultas';
import type {
  Denominacion,
  MetodoPago,
  MovimientoCaja,
  SucursalConCajas,
  TicketCierre,
  TurnoActual,
} from '../api/tipos';
import { BotonImprimir } from '../equipo/BotonImprimir';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { aCentavos, deCentavos, esMonto, totalContado } from '../util/dinero';
import { formatoFechaHora, formatoMonto, primerNombre } from '../util/formato';

// La caja. Regla que manda en toda esta pantalla: el arqueo es a ciegas. Aquí nunca aparece lo que
// el sistema espera que haya, ni la diferencia, ni cuánto se ha vendido: solo lo que la persona
// misma cuenta y escribe. Lo esperado y las diferencias están en el historial, para quien puede verlos.

type Moneda = 'NIO' | 'USD';
const SIMBOLO: Record<Moneda, string> = { NIO: 'C$', USD: 'US$' };

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Tarjeta className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {children}
    </Tarjeta>
  );
}

/** `?caja_id=7` cuando la caja la elige el administrador; nada cuando sale del equipo. */
const deCaja = (cajaId: number | null) => (cajaId === null ? '' : `?caja_id=${cajaId}`);
const conCaja = (cajaId: number | null) => (cajaId === null ? {} : { caja_id: cajaId });

function useRefrescarCaja() {
  const consultas = useQueryClient();
  return () =>
    Promise.all([
      consultas.invalidateQueries({ queryKey: ['caja'] }),
      consultas.invalidateQueries({ queryKey: ['turno'] }),
    ]);
}

// ---------------------------------------------------------------------------- Tipo de cambio

/** El tipo de cambio de hoy: sin él no se cobra en dólares. Lo registra quien tiene el permiso. */
function TipoDeCambio() {
  const sesion = useSesionActiva();
  const consultas = useQueryClient();
  const vigente = useTipoCambio();
  const [valor, setValor] = useState('');
  const [porConfirmar, setPorConfirmar] = useState<string | null>(null);
  const puede = tienePermiso(sesion, ['TIPO_CAMBIO_GESTIONAR']);

  const guardar = useMutation({
    mutationFn: (confirmar: boolean) =>
      api('PUT', '/tipo-cambio', { cuerpo: { usd_a_nio: valor.trim(), confirmar } }),
    onSuccess: async () => {
      setPorConfirmar(null);
      setValor('');
      await consultas.invalidateQueries({ queryKey: ['tipo-cambio'] });
    },
    onError: (error) => {
      // Se aleja mucho del último registrado: la base pide que alguien lo confirme a propósito
      if (error instanceof ErrorApi && error.codigo === 'CONFIRMACION_REQUERIDA') {
        setPorConfirmar(error.message);
      }
    },
  });
  const errorVisible =
    guardar.isError &&
    !(guardar.error instanceof ErrorApi && guardar.error.codigo === 'CONFIRMACION_REQUERIDA');

  return (
    <Bloque titulo="Tipo de cambio de hoy">
      {vigente?.es_de_hoy ? (
        <p>
          US$ 1 = <span className="font-semibold">C$ {Number(vigente.usd_a_nio).toFixed(4)}</span>
        </p>
      ) : (
        <Aviso tipo="aviso">
          Todavía no se registra el tipo de cambio de hoy
          {vigente && ` (el último es C$ ${Number(vigente.usd_a_nio).toFixed(4)})`}. Sin él no se
          cobra en dólares.
          {!puede && ' Pídale a la encargada o al administrador que lo registre.'}
        </Aviso>
      )}
      {puede && (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(evento) => {
            evento.preventDefault();
            guardar.mutate(false);
          }}
        >
          <div className="flex-1">
            <Campo
              etiqueta={vigente?.es_de_hoy ? 'Corregir: córdobas por dólar' : 'Córdobas por dólar'}
              name="usd_a_nio"
              inputMode="decimal"
              placeholder="36.6243"
              value={valor}
              onChange={(evento) => setValor(evento.target.value)}
            />
          </div>
          <Boton
            type="submit"
            variante="secundario"
            ocupado={guardar.isPending}
            disabled={!valor.trim()}
          >
            Guardar tipo de cambio
          </Boton>
        </form>
      )}
      {errorVisible && <Aviso tipo="error">{detalleDeError(guardar.error)}</Aviso>}
      {guardar.isSuccess && <Aviso tipo="exito">Tipo de cambio guardado.</Aviso>}
      <Confirmacion
        abierta={porConfirmar !== null}
        alCerrar={() => setPorConfirmar(null)}
        titulo="¿Seguro que es ese valor?"
        textoConfirmar="Sí, guardarlo"
        ocupado={guardar.isPending}
        alConfirmar={() => guardar.mutate(true)}
      >
        {porConfirmar}
      </Confirmacion>
    </Bloque>
  );
}

// ---------------------------------------------------------------------------- Abrir

/** Se abre declarando lo contado, sin ver el fondo que dejó el cierre anterior. */
function AbrirTurno({ cajaId }: { cajaId: number | null }) {
  const refrescar = useRefrescarCaja();
  const [nio, setNio] = useState('');
  const [usd, setUsd] = useState('');
  const valido = esMonto(nio || '0') && esMonto(usd || '0');
  const abrir = useMutation({
    mutationFn: () =>
      api<{ turno: TurnoActual }>('POST', '/caja/turno/abrir', {
        cuerpo: {
          inicial_nio: nio.trim() || '0',
          inicial_usd: usd.trim() || '0',
          ...conCaja(cajaId),
        },
      }),
    onSuccess: refrescar,
  });

  return (
    <Bloque titulo="Abrir la caja">
      <p className="text-texto-secundario">
        Cuente el efectivo que hay en la caja antes de empezar y escriba cuánto es.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          abrir.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Efectivo en córdobas (C$)"
            name="inicial_nio"
            inputMode="decimal"
            placeholder="0.00"
            value={nio}
            onChange={(evento) => setNio(evento.target.value)}
          />
          <Campo
            etiqueta="Efectivo en dólares (US$)"
            name="inicial_usd"
            inputMode="decimal"
            placeholder="0.00"
            value={usd}
            onChange={(evento) => setUsd(evento.target.value)}
          />
        </div>
        {!valido && (
          <Aviso tipo="error">
            Escriba los montos solo con números, por ejemplo 1500 o 1500.50.
          </Aviso>
        )}
        {abrir.isError && <Aviso tipo="error">{detalleDeError(abrir.error)}</Aviso>}
        <Boton type="submit" ocupado={abrir.isPending} disabled={!valido}>
          Abrir turno
        </Boton>
      </form>
    </Bloque>
  );
}

// ---------------------------------------------------------------------------- Movimientos

function Movimientos({ cajaId }: { cajaId: number | null }) {
  const consultas = useQueryClient();
  const [tipo, setTipo] = useState('EGRESO');
  const [moneda, setMoneda] = useState<Moneda>('NIO');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const lista = useQuery({
    queryKey: ['caja', 'movimientos', cajaId],
    queryFn: () =>
      api<{ movimientos: MovimientoCaja[] }>('GET', `/caja/turno/movimientos${deCaja(cajaId)}`),
  });
  const registrar = useMutation({
    mutationFn: () =>
      api('POST', '/caja/turno/movimientos', {
        cuerpo: { tipo, moneda, monto: monto.trim(), motivo: motivo.trim(), ...conCaja(cajaId) },
      }),
    onSuccess: async () => {
      setMonto('');
      setMotivo('');
      await consultas.invalidateQueries({ queryKey: ['caja', 'movimientos'] });
    },
  });

  return (
    <Bloque titulo="Entradas y salidas de efectivo">
      <form
        className="flex flex-col gap-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          registrar.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Selector
            etiqueta="Qué es"
            name="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="EGRESO">Salida de efectivo</option>
            <option value="INGRESO">Entrada de efectivo</option>
          </Selector>
          <Selector
            etiqueta="Moneda"
            name="moneda"
            value={moneda}
            onChange={(e) => setMoneda(e.target.value as Moneda)}
          >
            <option value="NIO">Córdobas (C$)</option>
            <option value="USD">Dólares (US$)</option>
          </Selector>
          <Campo
            etiqueta="Monto"
            name="monto"
            inputMode="decimal"
            placeholder="0.00"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
        </div>
        <Campo
          etiqueta="Motivo"
          name="motivo"
          placeholder="Pago del agua, cambio para la caja…"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        {registrar.isError && <Aviso tipo="error">{detalleDeError(registrar.error)}</Aviso>}
        <Boton
          type="submit"
          variante="secundario"
          ocupado={registrar.isPending}
          disabled={!esMonto(monto) || !motivo.trim()}
        >
          Registrar movimiento
        </Boton>
      </form>
      {lista.data && lista.data.movimientos.length > 0 && (
        <ul className="divide-y divide-borde border-t border-borde">
          {lista.data.movimientos.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-3">
              <span>
                <span className="block font-medium">{m.motivo}</span>
                <span className="block text-sm text-texto-secundario">
                  {formatoFechaHora(m.fecha)} · {primerNombre(m.usuario.nombre_completo)}
                </span>
              </span>
              <span className="text-right font-semibold whitespace-nowrap">
                {m.tipo === 'EGRESO' ? '− ' : '+ '}
                {formatoMonto(m.monto, m.moneda)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Bloque>
  );
}

// ---------------------------------------------------------------------------- Cerrar

function Contador({
  etiqueta,
  cantidad,
  alCambiar,
}: {
  etiqueta: string;
  cantidad: number;
  alCambiar: (cantidad: number) => void;
}) {
  const boton =
    'flex size-12 shrink-0 items-center justify-center rounded-xl border border-borde bg-superficie active:bg-esmeralda-claro disabled:opacity-40';
  return (
    <li className="flex items-center gap-2">
      <span className="flex-1 font-medium">{etiqueta}</span>
      <button
        type="button"
        className={boton}
        aria-label={`Quitar uno de ${etiqueta}`}
        disabled={cantidad === 0}
        onClick={() => alCambiar(cantidad - 1)}
      >
        <Minus className="size-5" aria-hidden />
      </button>
      <input
        aria-label={`Cantidad de ${etiqueta}`}
        inputMode="numeric"
        className="h-12 w-16 rounded-xl border border-borde bg-superficie text-center text-lg font-semibold"
        value={cantidad === 0 ? '' : String(cantidad)}
        placeholder="0"
        onChange={(evento) => {
          const numero = Number(evento.target.value.replace(/\D/g, ''));
          alCambiar(Number.isFinite(numero) ? Math.min(numero, 100_000) : 0);
        }}
      />
      <button
        type="button"
        className={boton}
        aria-label={`Agregar uno de ${etiqueta}`}
        onClick={() => alCambiar(cantidad + 1)}
      >
        <Plus className="size-5" aria-hidden />
      </button>
    </li>
  );
}

/** Cierre a ciegas: billete por billete y moneda por moneda. Si no cuadra, queda un solo reconteo. */
function CerrarTurno({
  turno,
  cajaId,
  alCerrar,
  alCancelar,
}: {
  turno: TurnoActual;
  cajaId: number | null;
  alCerrar: (ticket: TicketCierre) => void;
  alCancelar: () => void;
}) {
  const refrescar = useRefrescarCaja();
  const denominaciones = useQuery({
    queryKey: ['denominaciones'],
    queryFn: () => api<{ denominaciones: Denominacion[] }>('GET', '/denominaciones'),
    staleTime: Infinity,
  });
  const metodos = useQuery({
    queryKey: ['metodos-pago'],
    queryFn: () => api<{ metodos_pago: MetodoPago[] }>('GET', '/metodos-pago'),
    staleTime: Infinity,
  });
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [noEfectivo, setNoEfectivo] = useState<Record<string, string>>({});
  const [retiro, setRetiro] = useState<Record<Moneda, string>>({ NIO: '', USD: '' });
  const [justificacion, setJustificacion] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [noCuadro, setNoCuadro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const pideJustificacion = turno.cierre_pide_justificacion || noCuadro !== null;

  const todas = denominaciones.data?.denominaciones ?? [];
  const clave = (d: Denominacion) => `${d.moneda}-${d.valor}`;
  const contado = (moneda: Moneda) =>
    totalContado(
      todas
        .filter((d) => d.moneda === moneda)
        .map((d) => ({ valor: d.valor, cantidad: cantidades[clave(d)] ?? 0 })),
    );
  const otros = (metodos.data?.metodos_pago ?? []).filter((m) => !m.es_efectivo);
  const montosValidos =
    [...Object.values(noEfectivo), retiro.NIO, retiro.USD].every((m) => esMonto(m || '0')) &&
    aCentavos(retiro.NIO || '0') <= contado('NIO') &&
    aCentavos(retiro.USD || '0') <= contado('USD');
  const justificada = !pideJustificacion || justificacion.trim().length >= 10;

  const cerrar = useMutation({
    mutationFn: () =>
      api<{ ticket: TicketCierre }>('POST', '/caja/turno/cerrar', {
        cuerpo: {
          efectivo: todas
            .map((d) => ({ moneda: d.moneda, valor: d.valor, cantidad: cantidades[clave(d)] ?? 0 }))
            .filter((d) => d.cantidad > 0),
          no_efectivo: otros.map((m) => ({
            metodo: m.codigo,
            monto: noEfectivo[m.codigo]?.trim() || '0',
          })),
          retiro_nio: retiro.NIO.trim() || '0',
          retiro_usd: retiro.USD.trim() || '0',
          ...(justificacion.trim() ? { justificacion: justificacion.trim() } : {}),
          ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
          ...conCaja(cajaId),
        },
      }),
    onSuccess: async ({ ticket }) => {
      await refrescar();
      alCerrar(ticket);
    },
    onError: async (error) => {
      setConfirmar(false);
      if (error instanceof ErrorApi && error.codigo === 'CONTEO_NO_CUADRA') {
        setNoCuadro(error.message);
        await refrescar();
      }
    },
  });

  if (denominaciones.isPending || metodos.isPending) return <Cargando />;

  const grupo = (moneda: Moneda, tipo: string, titulo: string) => {
    const filas = todas.filter((d) => d.moneda === moneda && d.tipo === tipo).reverse();
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-texto-secundario">{titulo}</h3>
        <ul className="flex flex-col gap-2">
          {filas.map((d) => (
            <Contador
              key={clave(d)}
              etiqueta={`${SIMBOLO[moneda]} ${Number(d.valor)}`}
              cantidad={cantidades[clave(d)] ?? 0}
              alCambiar={(cantidad) => setCantidades((c) => ({ ...c, [clave(d)]: cantidad }))}
            />
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Cerrar la caja</h1>
        <p className="text-texto-secundario">
          {turno.sucursal.nombre} · {turno.caja.nombre}. Cuente todo el efectivo y anote cuántos
          billetes y monedas hay de cada uno.
        </p>
      </header>

      {pideJustificacion && (
        <Aviso tipo="aviso">
          <p className="font-semibold">{noCuadro ?? 'El conteo anterior no cuadró.'}</p>
          <p className="font-normal">
            Queda un solo reconteo: cuente otra vez con calma y escriba abajo qué pudo pasar. Con
            ese conteo se cierra la caja.
          </p>
        </Aviso>
      )}

      {(['NIO', 'USD'] as const).map((moneda) => (
        <Bloque key={moneda} titulo={moneda === 'NIO' ? 'Córdobas' : 'Dólares'}>
          {grupo(moneda, 'BILLETE', 'Billetes')}
          {grupo(moneda, 'MONEDA', 'Monedas')}
          <p className="border-t border-borde pt-3 text-right text-lg">
            Contado:{' '}
            <span className="font-semibold">
              {formatoMonto(deCentavos(contado(moneda)), moneda)}
            </span>
          </p>
        </Bloque>
      ))}

      {otros.length > 0 && (
        <Bloque titulo="Tarjeta y transferencias">
          <p className="text-texto-secundario">
            Sume los comprobantes del día de cada uno y escriba el total en córdobas.
          </p>
          {otros.map((m) => (
            <Campo
              key={m.codigo}
              etiqueta={`Total de ${m.nombre.toLowerCase()} (C$)`}
              name={`no-efectivo-${m.codigo}`}
              inputMode="decimal"
              placeholder="0.00"
              value={noEfectivo[m.codigo] ?? ''}
              onChange={(e) => setNoEfectivo((n) => ({ ...n, [m.codigo]: e.target.value }))}
            />
          ))}
        </Bloque>
      )}

      <Bloque titulo="Retiro">
        <p className="text-texto-secundario">
          Lo que se saca hoy de la caja. Lo que queda es el fondo con que se abre mañana.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['NIO', 'USD'] as const).map((moneda) => (
            <Campo
              key={moneda}
              etiqueta={`Se retira en ${moneda === 'NIO' ? 'córdobas (C$)' : 'dólares (US$)'}`}
              name={`retiro-${moneda}`}
              inputMode="decimal"
              placeholder="0.00"
              value={retiro[moneda]}
              onChange={(e) => setRetiro((r) => ({ ...r, [moneda]: e.target.value }))}
            />
          ))}
        </div>
      </Bloque>

      <Bloque titulo="Notas">
        {pideJustificacion && (
          <Campo
            etiqueta="Justificación (obligatoria, mínimo 10 letras)"
            name="justificacion"
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
          />
        )}
        <Campo
          etiqueta="Observaciones (opcional)"
          name="observaciones"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
      </Bloque>

      {!montosValidos && (
        <Aviso tipo="error">
          Revise los montos: solo números (por ejemplo 1500.50), y no se puede retirar más de lo
          contado.
        </Aviso>
      )}
      {cerrar.isError &&
        !(cerrar.error instanceof ErrorApi && cerrar.error.codigo === 'CONTEO_NO_CUADRA') && (
          <Aviso tipo="error">{detalleDeError(cerrar.error)}</Aviso>
        )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Boton variante="secundario" onClick={alCancelar}>
          Volver sin cerrar
        </Boton>
        <Boton disabled={!montosValidos || !justificada} onClick={() => setConfirmar(true)}>
          Cerrar la caja
        </Boton>
      </div>

      <Confirmacion
        abierta={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="¿Cerrar la caja con este conteo?"
        textoConfirmar="Sí, cerrar"
        ocupado={cerrar.isPending}
        alConfirmar={() => cerrar.mutate()}
      >
        Contó {formatoMonto(deCentavos(contado('NIO')))} y{' '}
        {formatoMonto(deCentavos(contado('USD')), 'USD')} en efectivo.
      </Confirmacion>
    </div>
  );
}

/** Lo que recibe quien cierra: lo que contó, lo que retiró y el fondo. Nunca lo esperado. */
function TicketDeCierre({ ticket, alTerminar }: { ticket: TicketCierre; alTerminar: () => void }) {
  const fila = (izquierda: string, derecha: string) => (
    <li key={izquierda} className="flex justify-between gap-3 py-2">
      <span>{izquierda}</span>
      <span className="font-semibold whitespace-nowrap">{derecha}</span>
    </li>
  );
  const moneda = (m: string): Moneda => (m === 'USD' ? 'USD' : 'NIO');
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <Aviso tipo="exito">
        La caja quedó cerrada. {ticket.sucursal} · {ticket.caja}
      </Aviso>
      <Bloque titulo="Cierre de caja">
        <ul className="divide-y divide-borde">
          {ticket.contado?.map((c) =>
            fila(`Contado: ${c.metodo}`, formatoMonto(c.monto, moneda(c.moneda))),
          )}
          {ticket.retiro_nio !== undefined && fila('Retiro C$', formatoMonto(ticket.retiro_nio))}
          {ticket.retiro_usd !== undefined &&
            fila('Retiro US$', formatoMonto(ticket.retiro_usd, 'USD'))}
          {ticket.fondo_siguiente_nio !== undefined &&
            fila('Fondo para mañana C$', formatoMonto(ticket.fondo_siguiente_nio))}
          {ticket.fondo_siguiente_usd !== undefined &&
            fila('Fondo para mañana US$', formatoMonto(ticket.fondo_siguiente_usd, 'USD'))}
          {/* Lo vendido y lo cobrado solo llegan a quien puede ver las diferencias */}
          {ticket.ventas !== undefined && fila('Ventas', String(ticket.ventas))}
          {ticket.total_vendido !== undefined &&
            fila('Vendido', formatoMonto(ticket.total_vendido))}
        </ul>
        <BotonImprimir ruta={`/turnos/${ticket.turno_id}/imprimir`} texto="Imprimir el cierre" />
        <Boton variante="secundario" onClick={alTerminar}>
          Listo
        </Boton>
      </Bloque>
    </div>
  );
}

// ---------------------------------------------------------------------------- La pantalla

/** El administrador fuera de un equipo registrado dice con qué caja trabaja. */
function ElegirCaja({
  cajaId,
  alElegir,
}: {
  cajaId: number | null;
  alElegir: (id: number | null) => void;
}) {
  const sucursales = useQuery({
    queryKey: ['sucursales'],
    queryFn: () => api<{ sucursales: SucursalConCajas[] }>('GET', '/sucursales'),
  });
  return (
    <Tarjeta>
      <Selector
        etiqueta="Caja con la que va a trabajar"
        name="caja"
        value={cajaId ?? ''}
        onChange={(e) => alElegir(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Elija…</option>
        {sucursales.data?.sucursales
          .filter((s) => s.activa)
          .flatMap((s) =>
            s.cajas
              .filter((c) => c.activa)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {s.nombre} · {c.nombre}
                </option>
              )),
          )}
      </Selector>
    </Tarjeta>
  );
}

export function Caja() {
  const sesion = useSesionActiva();
  const eligeCaja = sesion.equipo === null; // solo llega aquí el administrador sin equipo
  const [cajaId, setCajaId] = useState<number | null>(null);
  const [vista, setVista] = useState<'resumen' | 'cerrar'>('resumen');
  const [ticket, setTicket] = useState<TicketCierre | null>(null);
  const lista = !eligeCaja || cajaId !== null;

  const turno = useQuery({
    queryKey: ['caja', 'turno', cajaId],
    queryFn: () => api<{ turno: TurnoActual | null }>('GET', `/caja/turno${deCaja(cajaId)}`),
    enabled: lista,
  });
  const abierto = turno.data?.turno ?? null;

  if (ticket) return <TicketDeCierre ticket={ticket} alTerminar={() => setTicket(null)} />;
  if (vista === 'cerrar' && abierto) {
    return (
      <CerrarTurno
        turno={abierto}
        cajaId={cajaId}
        alCancelar={() => setVista('resumen')}
        alCerrar={(cierre) => {
          setVista('resumen');
          setTicket(cierre);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Caja</h1>
        {tienePermiso(sesion, ['CAJA_VER_DIFERENCIAS']) && (
          <Link
            to="/caja/turnos"
            className="flex min-h-toque items-center gap-2 rounded-xl px-3 font-semibold text-esmeralda hover:bg-esmeralda-claro"
          >
            <History className="size-5" aria-hidden /> Historial de turnos
          </Link>
        )}
      </header>

      {eligeCaja && <ElegirCaja cajaId={cajaId} alElegir={setCajaId} />}
      {lista && turno.isPending && <Cargando />}
      {turno.isError && <Aviso tipo="error">{detalleDeError(turno.error)}</Aviso>}

      {lista && turno.isSuccess && (
        <>
          {abierto ? (
            <Bloque titulo={`${abierto.sucursal.nombre} · ${abierto.caja.nombre}`}>
              <p className="flex flex-wrap items-center gap-2">
                <Etiqueta tono="exito">Turno abierto</Etiqueta>
                <span className="text-texto-secundario">
                  desde el {formatoFechaHora(abierto.fecha_apertura)}, por{' '}
                  {abierto.abierto_por.nombre_completo}
                </span>
              </p>
              {abierto.cierre_pide_justificacion && (
                <Aviso tipo="aviso">
                  Ya hubo un conteo de cierre que no cuadró: el siguiente es el definitivo y debe
                  llevar una justificación.
                </Aviso>
              )}
              {tienePermiso(sesion, ['CAJA_CERRAR']) && (
                <Boton onClick={() => setVista('cerrar')}>Cerrar la caja</Boton>
              )}
            </Bloque>
          ) : tienePermiso(sesion, ['CAJA_ABRIR']) ? (
            <AbrirTurno cajaId={cajaId} />
          ) : (
            <Aviso tipo="info">La caja está cerrada.</Aviso>
          )}
          <TipoDeCambio />
          {abierto && tienePermiso(sesion, ['CAJA_MOVIMIENTOS']) && <Movimientos cajaId={cajaId} />}
        </>
      )}
    </div>
  );
}
