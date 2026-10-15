import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ScanLine, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { api, detalleDeError } from '../api/cliente';
import type { Perforacion, PrecioPaquete, VarianteEncontrada } from '../api/tipos';
import { EscanerCamara } from '../equipo/EscanerCamara';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { aCentavos, deCentavos, esMonto } from '../util/dinero';
import { formatoMonto } from '../util/formato';
import { useRetrasado } from '../util/retrasado';
import {
  agregar,
  agregarPaquete,
  cambiarCantidad,
  cambiarPrecio,
  nombreDe,
  quedan,
  quitar,
  unidadesEnCarrito,
  type Linea,
  type Moneda,
} from './carrito';

// Armar lo que se lleva la clienta: el buscador y el escáner, la perforación con su pieza y los
// renglones con su cantidad y su precio. Lo usan la venta y el cambio de una devolución (que es una
// venta nueva, pagada en parte o del todo con lo devuelto). El precio establecido, el del paquete y
// las existencias son de la base: aquí solo se arma la lista.

export const pesos = (centavos: number, moneda: Moneda = 'NIO') =>
  formatoMonto(deCentavos(centavos), moneda);

export const botonRedondo =
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

export interface PaqueteEnCurso {
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

// ---------------------------------------------------------------------------- Lo que se arma

/** Lo que va en la venta, y la perforación con pieza que se está armando (si hay una). */
export interface Armado {
  lineas: Linea[];
  setLineas: (lineas: Linea[]) => void;
  paquete: PaqueteEnCurso | null;
  setPaquete: (paquete: PaqueteEnCurso | null) => void;
  /** Lo que se buscó o se escaneó entra aquí: una pieza suelta, o el primer paso de un paquete. */
  elegir: (variante: VarianteEncontrada) => void;
  aviso: string | null;
}

export function useArmado(): Armado {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [paquete, setPaquete] = useState<PaqueteEnCurso | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const perforaciones = useQuery({
    queryKey: ['perforaciones'],
    queryFn: () => api<{ perforaciones: Perforacion[] }>('GET', '/perforaciones'),
    staleTime: 5 * 60_000,
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

  return { lineas, setLineas, paquete, setPaquete, elegir, aviso };
}

/**
 * El buscador (con el escáner), la perforación con pieza que se está armando y la lista de lo que
 * va. `vacia` es lo que se dice mientras no hay nada.
 */
export function ArmarVenta({
  armado,
  sucursalId,
  puedeSubir,
  titulo = 'En la venta',
  vacia,
}: {
  armado: Armado;
  sucursalId: number;
  puedeSubir: boolean;
  titulo?: string;
  vacia: string;
}) {
  const { lineas, setLineas, paquete, setPaquete, elegir, aviso } = armado;
  const paqueteCompleto =
    paquete !== null && paquete.piezas.length === paquete.perforacion.piezas_por_paquete;

  return (
    <>
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
          sucursalId={sucursalId}
          modo={paquete ? 'pieza' : 'producto'}
          lineas={lineas}
          apartadas={paquete?.piezas}
          alElegir={elegir}
        />
      )}
      {aviso && <Aviso tipo="aviso">{aviso}</Aviso>}

      {lineas.length === 0 ? (
        !paquete && <p className="py-6 text-center text-texto-secundario">{vacia}</p>
      ) : (
        <Tarjeta>
          <h2 className="text-lg font-semibold">{titulo}</h2>
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
      )}
    </>
  );
}
