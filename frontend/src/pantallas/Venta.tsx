import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Minus, Plus, Receipt, ScanLine, Search, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorApi, api, detalleDeError } from '../api/cliente';
import { useTipoCambio } from '../api/consultas';
import type {
  CajaAbierta,
  MetodoPago,
  Perforacion,
  PrecioPaquete,
  PromocionDisponible,
  VarianteEncontrada,
  VentaDetalle,
} from '../api/tipos';
import { EscanerCamara } from '../equipo/EscanerCamara';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { aCentavos, deCentavos, esMonto, nuevoUuid } from '../util/dinero';
import { formatoMonto } from '../util/formato';
import { useRetrasado } from '../util/retrasado';
import {
  agregar,
  agregarPaquete,
  cambiarCantidad,
  cambiarPrecio,
  cuenta,
  enCordobas,
  itemsDeVenta,
  nombreDe,
  nuevoPago,
  pagosDeVenta,
  quedan,
  quitar,
  subtotal,
  unidadesEnCarrito,
  type Linea,
  type Moneda,
  type Pago,
} from '../venta/carrito';
import { useDestinoDeVenta, type Destino } from '../venta/destino';
import { VentaHecha } from '../venta/VentaHecha';

// Vender. Primero para el celular: se busca o se escanea, se arma la venta, se cobra y sale el
// ticket. El precio establecido, la promoción, las existencias y el vuelto son de la base: la
// pantalla suma lo que va en el carrito para mostrar el total antes de registrar la venta.

type Listo = Extract<Destino, { estado: 'listo' }>;

const pesos = (centavos: number, moneda: Moneda = 'NIO') =>
  formatoMonto(deCentavos(centavos), moneda);

const botonRedondo =
  'flex size-12 shrink-0 items-center justify-center rounded-xl border border-borde bg-superficie active:bg-esmeralda-claro disabled:opacity-40';

// ---------------------------------------------------------------------------- Buscar y escanear

interface PropsBuscador {
  sucursalId: number;
  /** `pieza`: se está eligiendo la pieza de una perforación; solo valen las que tienen gama. */
  modo: 'producto' | 'pieza';
  lineas: Linea[];
  /** Piezas ya elegidas para el paquete que se está armando: también gastan existencias. */
  apartadas?: VarianteEncontrada[];
  alElegir: (variante: VarianteEncontrada) => void;
}

/** El buscador y el escáner. Escanear es el camino rápido; el buscador siempre está. */
function Buscador({ sucursalId, modo, lineas, apartadas = [], alElegir }: PropsBuscador) {
  const consultas = useQueryClient();
  const [texto, setTexto] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'exito' | 'aviso'; texto: string } | null>(null);
  const buscado = useRetrasado(texto.trim());

  const buscar = (que: string) => ({
    queryKey: ['venta', 'buscar', que, sucursalId],
    queryFn: () =>
      api<{ variantes: VarianteEncontrada[] }>(
        'GET',
        `/variantes/buscar?texto=${encodeURIComponent(que)}&limite=20&sucursal_id=${sucursalId}`,
      ),
  });
  const resultados = useQuery({ ...buscar(buscado), enabled: buscado.length >= 2 });

  const vale = (v: VarianteEncontrada) =>
    modo === 'producto' || (v.tipo === 'PRODUCTO' && v.gama !== null);
  /** ¿Queda alguna para agregar? Cuenta lo que ya va en la venta y las piezas del paquete en curso. */
  const hay = (v: VarianteEncontrada) =>
    v.stock === null ||
    unidadesEnCarrito(lineas, v.id) + apartadas.filter((p) => p.id === v.id).length < v.stock;

  const elegir = (v: VarianteEncontrada) => {
    alElegir(v);
    setTexto('');
    setAviso({ tipo: 'exito', texto: `Agregado: ${nombreDe(v)}` });
  };

  /** Un código escaneado o escrito entero: si es de un solo producto, entra sin más toques. */
  const porCodigo = async (codigo: string) => {
    const limpio = codigo.trim();
    if (limpio.length < 2) return;
    setAviso(null);
    try {
      const { variantes } = await consultas.fetchQuery(buscar(limpio));
      const candidatas = variantes.filter(vale);
      const exacta =
        candidatas.find((v) =>
          [v.sku, v.codigo_barras].some((c) => c?.toLowerCase() === limpio.toLowerCase()),
        ) ?? (candidatas.length === 1 ? candidatas[0] : undefined);
      if (!exacta) {
        setTexto(limpio); // se muestran los resultados (o que no hay) para elegir tocando
        return;
      }
      if (!hay(exacta)) {
        setAviso({ tipo: 'aviso', texto: `No quedan existencias de ${nombreDe(exacta)}.` });
        return;
      }
      elegir(exacta);
    } catch {
      setTexto(limpio);
    }
  };

  // Mientras se escribe (o recién agregado algo) lo que hay en pantalla es de otra búsqueda: no se muestra
  const alDia = texto.trim() === buscado && buscado.length >= 2;
  const lista = alDia ? (resultados.data?.variantes ?? []).filter(vale) : [];

  return (
    <Tarjeta className="flex flex-col gap-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          void porCodigo(texto);
        }}
      >
        <div className="flex-1">
          <Campo
            etiqueta={
              modo === 'pieza'
                ? 'Buscar la pieza por nombre o código'
                : 'Buscar por nombre o código'
            }
            name="buscar"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder={modo === 'pieza' ? 'Labret, PTI-00012…' : 'Cadena, lóbulo, PTI-00012…'}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setAviso(null);
            }}
          />
        </div>
        <Boton
          variante={escaneando ? 'primario' : 'secundario'}
          aria-pressed={escaneando}
          onClick={() => setEscaneando(!escaneando)}
        >
          <ScanLine className="size-5" aria-hidden />
          <span className="sr-only sm:not-sr-only">
            {escaneando ? 'Cerrar cámara' : 'Escanear'}
          </span>
        </Boton>
      </form>
      {escaneando && <EscanerCamara alLeer={(codigo) => void porCodigo(codigo)} />}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {(resultados.isFetching || (texto.trim().length >= 2 && !alDia)) && (
        <Cargando texto="Buscando…" />
      )}
      {alDia && resultados.isError && (
        <Aviso tipo="error">{detalleDeError(resultados.error)}</Aviso>
      )}
      {alDia && resultados.isSuccess && lista.length === 0 && (
        <p className="py-2 text-center text-texto-secundario">
          {modo === 'pieza'
            ? `No hay ninguna pieza de perforación con «${buscado}».`
            : `No hay ningún producto con «${buscado}».`}
        </p>
      )}
      {lista.length > 0 && (
        <ul className="divide-y divide-borde border-t border-borde" aria-label="Resultados">
          {lista.map((v) => {
            const disponible = hay(v);
            return (
              <li key={v.id}>
                <button
                  type="button"
                  disabled={!disponible}
                  onClick={() => elegir(v)}
                  className="flex min-h-toque w-full items-center justify-between gap-3 py-3 text-left active:bg-esmeralda-claro disabled:opacity-55"
                >
                  <span>
                    <span className="block font-medium">{nombreDe(v)}</span>
                    <span className="block text-sm text-texto-secundario">
                      {v.sku}
                      {v.gama && ` · ${v.gama}`}
                      {v.stock !== null &&
                        ` · ${disponible ? `hay ${v.stock}` : 'sin existencias'}`}
                    </span>
                  </span>
                  <span className="text-right font-semibold whitespace-nowrap">
                    {v.precio === null ? 'Según la pieza' : formatoMonto(v.precio)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {texto.trim().length < 2 && !escaneando && !aviso && (
        <p className="flex items-center gap-2 text-sm text-texto-secundario">
          <Search className="size-4" aria-hidden /> Escriba al menos dos letras, o escanee el
          código.
        </p>
      )}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------- Perforación con pieza

interface PaqueteEnCurso {
  variante: VarianteEncontrada;
  perforacion: Perforacion;
  piezas: VarianteEncontrada[];
}

/** La perforación con pieza se arma eligiendo su pieza: el precio lo da la base según cuál sea. */
function ArmarPaquete({
  paquete,
  alQuitarPieza,
  alCancelar,
  alAgregar,
}: {
  paquete: PaqueteEnCurso;
  alQuitarPieza: (indice: number) => void;
  alCancelar: () => void;
  alAgregar: (precio: string) => void;
}) {
  const { perforacion, piezas } = paquete;
  const completo = piezas.length === perforacion.piezas_por_paquete;
  const ids = piezas.map((p) => p.id).join(',');
  const precio = useQuery({
    queryKey: ['precio-paquete', perforacion.id, ids],
    queryFn: () =>
      api<PrecioPaquete>('GET', `/perforaciones/${perforacion.id}/precio-paquete?piezas=${ids}`),
    enabled: completo,
    retry: false,
  });

  return (
    <Tarjeta className="flex flex-col gap-3 border-esmeralda">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{nombreDe(paquete.variante)}</h2>
          <p className="text-texto-secundario">
            {completo
              ? 'Revise la pieza y agréguela a la venta.'
              : perforacion.piezas_por_paquete === 1
                ? 'Busque o escanee la pieza que se lleva.'
                : `Busque o escanee las piezas: ${piezas.length} de ${perforacion.piezas_por_paquete}.`}
          </p>
        </div>
        <Boton variante="texto" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
      {piezas.length > 0 && (
        <ul className="flex flex-col gap-2">
          {piezas.map((pieza, i) => (
            <li
              key={`${pieza.id}-${i}`}
              className="flex items-center justify-between gap-2 rounded-xl bg-fondo px-3 py-2"
            >
              <span>
                <span className="block font-medium">{nombreDe(pieza)}</span>
                <span className="block text-sm text-texto-secundario">
                  {pieza.sku}
                  {pieza.gama && ` · ${pieza.gama}`}
                </span>
              </span>
              <button
                type="button"
                className={botonRedondo}
                aria-label={`Quitar ${nombreDe(pieza)}`}
                onClick={() => alQuitarPieza(i)}
              >
                <X className="size-5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {completo && precio.isPending && <Cargando texto="Calculando el precio…" />}
      {precio.isError && <Aviso tipo="error">{detalleDeError(precio.error)}</Aviso>}
      {completo && precio.data && (
        <>
          <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-3">
            <span>Precio con la pieza</span>
            <span className="text-xl font-semibold">{formatoMonto(precio.data.precio)}</span>
          </p>
          <Boton onClick={() => alAgregar(precio.data.precio)}>Agregar a la venta</Boton>
        </>
      )}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------- El carrito

function Renglon({
  linea,
  puedeSubir,
  puedeSumar,
  alCambiar,
}: {
  linea: Linea;
  puedeSubir: boolean;
  puedeSumar: boolean;
  alCambiar: (cambio: { cantidad?: number; precio?: number; quitar?: boolean }) => void;
}) {
  const nombre = nombreDe(linea.variante);
  const [editando, setEditando] = useState(false);
  const [precio, setPrecio] = useState('');
  const [porConfirmar, setPorConfirmar] = useState<number | null>(null);
  const esPaquete = linea.piezas.length > 0;
  const invalido = precio.trim() !== '' && !esMonto(precio);
  const menor = esMonto(precio) && aCentavos(precio) < linea.lista;
  const abrirPrecio = () => {
    setPrecio(deCentavos(linea.precio));
    setEditando(true);
  };
  const aplicar = (nuevo: number) => {
    alCambiar({ precio: nuevo });
    setPorConfirmar(null);
    setEditando(false);
  };

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{nombre}</p>
          {linea.piezas.map((pieza, i) => (
            <p key={`${pieza.id}-${i}`} className="text-sm text-texto-secundario">
              + {nombreDe(pieza)}
            </p>
          ))}
          <p className="text-sm text-texto-secundario">
            {pesos(linea.precio)} c/u
            {linea.precio > linea.lista && (
              <>
                {' '}
                <Etiqueta tono="info">Establecido {pesos(linea.lista)}</Etiqueta>
              </>
            )}
          </p>
        </div>
        <p className="font-semibold whitespace-nowrap">{pesos(linea.cantidad * linea.precio)}</p>
      </div>
      <div className="flex items-center gap-2">
        {!esPaquete && (
          <>
            <button
              type="button"
              className={botonRedondo}
              aria-label={`Quitar uno de ${nombre}`}
              onClick={() => alCambiar({ cantidad: linea.cantidad - 1 })}
            >
              <Minus className="size-5" aria-hidden />
            </button>
            <span
              className="w-10 text-center text-lg font-semibold"
              aria-label={`Cantidad de ${nombre}`}
            >
              {linea.cantidad}
            </span>
            <button
              type="button"
              className={botonRedondo}
              aria-label={`Agregar uno de ${nombre}`}
              disabled={!puedeSumar}
              onClick={() => alCambiar({ cantidad: linea.cantidad + 1 })}
            >
              <Plus className="size-5" aria-hidden />
            </button>
          </>
        )}
        <button
          type="button"
          className={`${botonRedondo} ml-auto`}
          aria-label={`Quitar ${nombre} de la venta`}
          onClick={() => alCambiar({ quitar: true })}
        >
          <Trash2 className="size-5" aria-hidden />
        </button>
      </div>
      {/* En su propio renglón: en un celular no cabe al lado de la cantidad */}
      {puedeSubir && !editando && (
        <Boton variante="texto" className="self-start px-3" onClick={abrirPrecio}>
          Cambiar precio
        </Boton>
      )}
      {editando && (
        <form
          className="flex items-end gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (invalido || menor || !esMonto(precio)) return;
            const nuevo = aCentavos(precio);
            // Hacia arriba no hay tope, pero más del doble puede ser un error de dedo: se pregunta
            if (nuevo > 2 * linea.lista) setPorConfirmar(nuevo);
            else aplicar(nuevo);
          }}
        >
          <div className="flex-1">
            <Campo
              etiqueta={`Precio por unidad de ${nombre} (C$)`}
              name={`precio-${linea.clave}`}
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              error={
                invalido
                  ? 'Escriba solo números, por ejemplo 700 o 700.50.'
                  : menor
                    ? `No puede ser menor que el precio establecido (${pesos(linea.lista)}).`
                    : undefined
              }
              ayuda="Solo se puede cobrar más que el precio establecido, nunca menos."
            />
          </div>
          <Boton type="submit" variante="secundario">
            Aplicar
          </Boton>
        </form>
      )}
      <Confirmacion
        abierta={porConfirmar !== null}
        alCerrar={() => setPorConfirmar(null)}
        titulo="¿Seguro?"
        textoConfirmar="Sí, cobrar ese precio"
        alConfirmar={() => porConfirmar !== null && aplicar(porConfirmar)}
      >
        El precio de {nombre} queda en {pesos(porConfirmar ?? 0)}, más del doble del establecido (
        {pesos(linea.lista)}).
      </Confirmacion>
    </li>
  );
}

function Fila({ etiqueta, children }: { etiqueta: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span>{etiqueta}</span>
      <span className="font-semibold whitespace-nowrap">{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------- Cobrar

const OPCION = (codigo: string, moneda: Moneda) => `${codigo}|${moneda}`;

function Cobro({
  total,
  pagos,
  metodos,
  usdANio,
  cliente,
  alCambiarPagos,
  alCambiarCliente,
  alVolver,
  alRegistrar,
  registrando,
  error,
}: {
  total: number;
  pagos: Pago[];
  metodos: MetodoPago[];
  /** El tipo de cambio de hoy; null si no se ha registrado (no se cobra en dólares). */
  usdANio: string | null;
  cliente: { nombre: string; telefono: string };
  alCambiarPagos: (pagos: Pago[]) => void;
  alCambiarCliente: (cliente: { nombre: string; telefono: string }) => void;
  alVolver: () => void;
  alRegistrar: () => void;
  registrando: boolean;
  error: unknown;
}) {
  const [conCliente, setConCliente] = useState(false);
  const estado = cuenta(total, pagos, metodos, usdANio);
  const opciones = metodos.flatMap((m) =>
    m.es_efectivo
      ? [
          { valor: OPCION(m.codigo, 'NIO'), texto: `${m.nombre} en córdobas`, sirve: true },
          {
            valor: OPCION(m.codigo, 'USD'),
            texto: `${m.nombre} en dólares`,
            sirve: usdANio !== null,
          },
        ]
      : [{ valor: OPCION(m.codigo, 'NIO'), texto: m.nombre, sirve: true }],
  );
  const cambiar = (clave: string, cambio: Partial<Pago>) =>
    alCambiarPagos(pagos.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)));
  const sinConexion = error instanceof ErrorApi && error.codigo === 'SIN_CONEXION';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <button
          type="button"
          className={botonRedondo}
          aria-label="Volver a la venta"
          onClick={alVolver}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-2xl font-semibold">Cobrar</h1>
      </header>

      <Tarjeta className="flex items-baseline justify-between gap-3">
        <span className="text-lg">Total a cobrar</span>
        <span className="text-3xl font-semibold">{pesos(total)}</span>
      </Tarjeta>

      {usdANio === null && (
        <Aviso tipo="aviso">
          Falta el tipo de cambio de hoy: mientras no se registre, no se cobra en dólares.
        </Aviso>
      )}

      {pagos.map((pago, i) => {
        const metodo = metodos.find((m) => m.codigo === pago.metodo);
        const numero = pagos.length > 1 ? ` ${i + 1}` : '';
        const faltaSinEste =
          total - pagos.reduce((s, p) => s + (p === pago ? 0 : (enCordobas(p, usdANio) ?? 0)), 0);
        const enNio = pago.moneda === 'USD' ? enCordobas(pago, usdANio) : null;
        return (
          <Tarjeta key={pago.clave} className="flex flex-col gap-3">
            <Selector
              etiqueta={`Forma de pago${numero}`}
              name={`metodo-${pago.clave}`}
              value={OPCION(pago.metodo, pago.moneda)}
              onChange={(e) => {
                const [codigo, moneda] = e.target.value.split('|');
                cambiar(pago.clave, { metodo: codigo, moneda: moneda as Moneda, referencia: '' });
              }}
            >
              {opciones.map((o) => (
                <option key={o.valor} value={o.valor} disabled={!o.sirve}>
                  {o.texto}
                </option>
              ))}
            </Selector>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Campo
                  etiqueta={`Monto${numero} (${pago.moneda === 'USD' ? 'US$' : 'C$'})`}
                  name={`monto-${pago.clave}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={pago.monto}
                  onChange={(e) => cambiar(pago.clave, { monto: e.target.value })}
                  ayuda={enNio !== null ? `Equivale a ${pesos(enNio)}` : undefined}
                />
              </div>
              {pago.moneda === 'NIO' && faltaSinEste > 0 && (
                <Boton
                  variante="secundario"
                  onClick={() => cambiar(pago.clave, { monto: deCentavos(faltaSinEste) })}
                >
                  Exacto
                </Boton>
              )}
            </div>
            {metodo?.requiere_referencia && (
              <Campo
                etiqueta={`Referencia${numero} (número del voucher o de la transferencia)`}
                name={`referencia-${pago.clave}`}
                autoComplete="off"
                maxLength={60}
                value={pago.referencia}
                onChange={(e) => cambiar(pago.clave, { referencia: e.target.value })}
              />
            )}
            {pagos.length > 1 && (
              <Boton
                variante="texto"
                className="self-start px-3"
                onClick={() => alCambiarPagos(pagos.filter((p) => p !== pago))}
              >
                Quitar este pago
              </Boton>
            )}
          </Tarjeta>
        );
      })}
      <Boton
        variante="secundario"
        onClick={() => alCambiarPagos([...pagos, nuevoPago(metodos[0]?.codigo ?? 'EFECTIVO')])}
      >
        <Plus className="size-5" aria-hidden /> Agregar otra forma de pago
      </Boton>

      <Tarjeta className="flex flex-col gap-2">
        <Fila etiqueta="Pagado">{pesos(estado.pagado)}</Fila>
        {estado.falta > 0 ? (
          <Fila etiqueta="Falta">
            <span className="text-aviso">{pesos(estado.falta)}</span>
          </Fila>
        ) : (
          <p className="flex items-baseline justify-between gap-3 border-t border-borde pt-2">
            <span className="text-lg">Vuelto</span>
            <span className="text-2xl font-semibold">{pesos(estado.vuelto)}</span>
          </p>
        )}
        {estado.pendiente && <p className="text-sm text-texto-secundario">{estado.pendiente}</p>}
      </Tarjeta>

      {conCliente ? (
        <Tarjeta className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Nombre del cliente (opcional)"
            name="cliente_nombre"
            maxLength={120}
            value={cliente.nombre}
            onChange={(e) => alCambiarCliente({ ...cliente, nombre: e.target.value })}
          />
          <Campo
            etiqueta="Teléfono (opcional)"
            name="cliente_telefono"
            inputMode="tel"
            maxLength={20}
            value={cliente.telefono}
            onChange={(e) => alCambiarCliente({ ...cliente, telefono: e.target.value })}
          />
        </Tarjeta>
      ) : (
        <Boton variante="texto" className="self-start" onClick={() => setConCliente(true)}>
          Anotar el nombre del cliente
        </Boton>
      )}

      {error !== null &&
        (sinConexion ? (
          <Aviso tipo="error">
            No hay conexión con el servidor, así que la venta no está confirmada. Revise el internet
            y toque «Reintentar»: si ya había entrado, no se duplica.
          </Aviso>
        ) : (
          <Aviso tipo="error">{detalleDeError(error)}</Aviso>
        ))}
      <Boton ocupado={registrando} disabled={estado.pendiente !== null} onClick={alRegistrar}>
        {sinConexion ? 'Reintentar' : 'Registrar la venta'}
      </Boton>
    </div>
  );
}

// ---------------------------------------------------------------------------- El mostrador

/** El carrito y el cobro de una venta, en el turno donde va a entrar. */
function Mostrador({
  destino,
  alRegistrar,
}: {
  destino: Listo;
  alRegistrar: (v: VentaDetalle) => void;
}) {
  const sesion = useSesionActiva();
  const consultas = useQueryClient();
  const tipoCambio = useTipoCambio();
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [paquete, setPaquete] = useState<PaqueteEnCurso | null>(null);
  const [paso, setPaso] = useState<'carrito' | 'cobro'>('carrito');
  const [promocionId, setPromocionId] = useState<number | null>(null);
  const [pagos, setPagos] = useState<Pago[]>(() => [nuevoPago('EFECTIVO')]);
  const [cliente, setCliente] = useState({ nombre: '', telefono: '' });
  const [aviso, setAviso] = useState<string | null>(null);
  // La misma clave en cada intento de esta venta: si la respuesta se pierde, reintentar no duplica
  const [clave] = useState(nuevoUuid);
  const puedeSubir = tienePermiso(sesion, ['VENTAS_MODIFICAR_PRECIO']);
  const puedePromocion = tienePermiso(sesion, ['VENTAS_PROMOCION']);

  const perforaciones = useQuery({
    queryKey: ['perforaciones'],
    queryFn: () => api<{ perforaciones: Perforacion[] }>('GET', '/perforaciones'),
    staleTime: 5 * 60_000,
  });
  const metodos = useQuery({
    queryKey: ['metodos-pago'],
    queryFn: () => api<{ metodos_pago: MetodoPago[] }>('GET', '/metodos-pago'),
    staleTime: Infinity,
  });

  const suma = subtotal(lineas);
  const promociones = useQuery({
    queryKey: ['promociones', 'disponibles', suma],
    queryFn: () =>
      api<{ promociones: PromocionDisponible[] }>(
        'GET',
        `/promociones/disponibles?subtotal=${deCentavos(suma)}`,
      ),
    enabled: puedePromocion && suma > 0,
    placeholderData: (anterior) => anterior,
  });
  // La rebaja la calcula la base para el subtotal de este momento; si deja de aplicar, no se usa
  const promocion =
    promociones.data?.promociones.find((p) => p.id === promocionId && p.aplica) ?? null;
  const calculando = promocionId !== null && promociones.isPlaceholderData;
  const descuento = promocion?.descuento ? aCentavos(promocion.descuento) : 0;
  const total = suma - descuento;

  const registrar = useMutation({
    mutationFn: () =>
      api<{ venta: VentaDetalle }>('POST', '/ventas', {
        cuerpo: {
          clave_idempotencia: clave,
          items: itemsDeVenta(lineas),
          pagos: pagosDeVenta(pagos),
          ...(promocion ? { promocion_id: promocion.id } : {}),
          ...(cliente.nombre.trim() ? { cliente_nombre: cliente.nombre.trim() } : {}),
          ...(cliente.telefono.trim() ? { cliente_telefono: cliente.telefono.trim() } : {}),
          ...(destino.cajaId === null ? {} : { caja_id: destino.cajaId }),
        },
      }),
    onSuccess: async ({ venta }) => {
      await consultas.invalidateQueries({ queryKey: ['ventas'] });
      // las existencias cambiaron: la próxima búsqueda vuelve a preguntar
      await consultas.invalidateQueries({ queryKey: ['venta', 'buscar'] });
      alRegistrar(venta);
    },
  });

  const elegir = (variante: VarianteEncontrada) => {
    setAviso(null);
    if (paquete) {
      setPaquete({ ...paquete, piezas: [...paquete.piezas, variante] });
      return;
    }
    if (variante.tipo !== 'PAQUETE') {
      setLineas(agregar(lineas, variante));
      return;
    }
    const perforacion = perforaciones.data?.perforaciones.find(
      (p) => p.paquete_variante_id === variante.id,
    );
    if (!perforacion) {
      setAviso('No se encontró esa perforación. Vuelva a intentarlo en un momento.');
      return;
    }
    setPaquete({ variante, perforacion, piezas: [] });
  };

  if (paso === 'cobro') {
    return (
      <Cobro
        total={total}
        pagos={pagos}
        metodos={metodos.data?.metodos_pago ?? []}
        usdANio={tipoCambio?.es_de_hoy ? tipoCambio.usd_a_nio : null}
        cliente={cliente}
        alCambiarPagos={(nuevos) => {
          registrar.reset();
          setPagos(nuevos);
        }}
        alCambiarCliente={setCliente}
        alVolver={() => {
          registrar.reset();
          setPaso('carrito');
        }}
        alRegistrar={() => registrar.mutate()}
        registrando={registrar.isPending}
        error={registrar.error}
      />
    );
  }

  const paqueteCompleto =
    paquete !== null && paquete.piezas.length === paquete.perforacion.piezas_por_paquete;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vender</h1>
          <p className="text-texto-secundario">
            {destino.sucursal.nombre} · {destino.caja.nombre}
          </p>
        </div>
        <Link
          to="/venta/del-turno"
          className="flex min-h-toque items-center gap-2 rounded-xl px-3 font-semibold text-esmeralda hover:bg-esmeralda-claro"
        >
          <Receipt className="size-5" aria-hidden /> Ventas del turno
        </Link>
      </header>

      {paquete && (
        <ArmarPaquete
          paquete={paquete}
          alCancelar={() => setPaquete(null)}
          alQuitarPieza={(indice) =>
            setPaquete({ ...paquete, piezas: paquete.piezas.filter((_, i) => i !== indice) })
          }
          alAgregar={(precio) => {
            setLineas(agregarPaquete(lineas, paquete.variante, paquete.piezas, precio));
            setPaquete(null);
          }}
        />
      )}
      {!paqueteCompleto && (
        <Buscador
          key={paquete ? 'pieza' : 'producto'}
          sucursalId={destino.sucursal.id}
          modo={paquete ? 'pieza' : 'producto'}
          lineas={lineas}
          apartadas={paquete?.piezas}
          alElegir={elegir}
        />
      )}
      {aviso && <Aviso tipo="aviso">{aviso}</Aviso>}

      {lineas.length === 0 ? (
        !paquete && (
          <p className="py-6 text-center text-texto-secundario">
            La venta está vacía. Busque o escanee lo que se lleva la clienta.
          </p>
        )
      ) : (
        <>
          <Tarjeta>
            <h2 className="text-lg font-semibold">En la venta</h2>
            <ul className="divide-y divide-borde">
              {lineas.map((linea) => (
                <Renglon
                  key={linea.clave}
                  linea={linea}
                  puedeSubir={puedeSubir}
                  puedeSumar={quedan(lineas, linea.variante)}
                  alCambiar={(cambio) => {
                    if (cambio.quitar) setLineas(quitar(lineas, linea.clave));
                    else if (cambio.cantidad !== undefined) {
                      setLineas(cambiarCantidad(lineas, linea.clave, cambio.cantidad));
                    } else if (cambio.precio !== undefined) {
                      setLineas(cambiarPrecio(lineas, linea.clave, cambio.precio));
                    }
                  }}
                />
              ))}
            </ul>
          </Tarjeta>

          <Tarjeta className="flex flex-col gap-3">
            {puedePromocion && (promociones.data?.promociones.length ?? 0) > 0 && (
              <Selector
                etiqueta="Promoción"
                name="promocion"
                value={promocion?.id ?? ''}
                onChange={(e) => setPromocionId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Sin promoción</option>
                {promociones.data?.promociones.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.aplica}>
                    {p.nombre}
                    {p.aplica
                      ? p.descuento && ` (−${formatoMonto(p.descuento)})`
                      : ` (desde ${formatoMonto(p.compra_minima)})`}
                  </option>
                ))}
              </Selector>
            )}
            {promocionId !== null && !promocion && !calculando && (
              <Aviso tipo="aviso">
                La promoción ya no aplica a esta venta (no llega a la compra mínima).
              </Aviso>
            )}
            {descuento > 0 && (
              <>
                <Fila etiqueta="Subtotal">{pesos(suma)}</Fila>
                <Fila etiqueta={<Etiqueta tono="oro">{promocion?.nombre}</Etiqueta>}>
                  −{pesos(descuento)}
                </Fila>
              </>
            )}
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-lg">Total</span>
              <span className="text-3xl font-semibold">{pesos(total)}</span>
            </p>
            <Boton disabled={paquete !== null || calculando} onClick={() => setPaso('cobro')}>
              Cobrar {pesos(total)}
            </Boton>
            {paquete && (
              <p className="text-sm text-texto-secundario">
                Termine de armar la perforación con pieza, o cancélela, antes de cobrar.
              </p>
            )}
          </Tarjeta>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- La pantalla

function ElegirCaja({
  cajas,
  elegida,
  alElegir,
}: {
  cajas: CajaAbierta[];
  elegida: number | null;
  alElegir: (cajaId: number | null) => void;
}) {
  return (
    <Tarjeta>
      <Selector
        etiqueta="Caja donde entra la venta"
        name="caja"
        value={elegida ?? ''}
        onChange={(e) => alElegir(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Elija…</option>
        {cajas.map((c) => (
          <option key={c.caja.id} value={c.caja.id}>
            {c.sucursal.nombre} · {c.caja.nombre}
          </option>
        ))}
      </Selector>
    </Tarjeta>
  );
}

export function Venta() {
  const sesion = useSesionActiva();
  const [cajaElegida, setCajaElegida] = useState<number | null>(null);
  const [hecha, setHecha] = useState<VentaDetalle | null>(null);
  const destino = useDestinoDeVenta(cajaElegida);

  if (hecha) return <VentaHecha venta={hecha} alSeguir={() => setHecha(null)} />;

  if (destino.estado === 'listo') {
    return (
      <div className="flex flex-col gap-4">
        {destino.cajas.length > 1 && (
          <ElegirCaja cajas={destino.cajas} elegida={destino.cajaId} alElegir={setCajaElegida} />
        )}
        {/* Otra caja es otra venta: el carrito empieza de nuevo */}
        <Mostrador key={destino.turnoId} destino={destino} alRegistrar={setHecha} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Vender</h1>
      {destino.estado === 'cargando' && <Cargando />}
      {destino.estado === 'error' && <Aviso tipo="error">{destino.mensaje}</Aviso>}
      {destino.estado === 'elegir' && (
        <>
          <Aviso tipo="info">Hay más de una caja abierta. Elija en cuál entra la venta.</Aviso>
          <ElegirCaja cajas={destino.cajas} elegida={null} alElegir={setCajaElegida} />
        </>
      )}
      {destino.estado === 'sin-turno' &&
        (sesion.equipo ? (
          <Aviso tipo="aviso">
            <p className="font-semibold">La caja está cerrada.</p>
            <p className="font-normal">
              Para vender hay que abrirla primero.{' '}
              {tienePermiso(sesion, ['CAJA_ABRIR']) && (
                <Link to="/caja" className="font-semibold text-esmeralda underline">
                  Ir a la caja
                </Link>
              )}
            </p>
          </Aviso>
        ) : (
          <Aviso tipo="aviso">
            <p className="font-semibold">No hay ninguna caja abierta en su sucursal.</p>
            <p className="font-normal">
              La caja se abre en el equipo de la sucursal. En cuanto esté abierta, podrá vender
              desde aquí.
            </p>
          </Aviso>
        ))}
    </div>
  );
}
