import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Minus,
  Plus,
  Printer,
  ScanLine,
  Search,
  Share2,
  Tags,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiArchivo, api, detalleDeError, mensajeDeError } from '../api/cliente';
import type { CompraParaEtiquetas, PiezaEtiqueta } from '../api/tipos';
import { EscanerCamara } from '../equipo/EscanerCamara';
import { imprimirConDialogo } from '../equipo/imprimir';
import {
  COPIAS_MAXIMAS,
  HOJA_DE_30,
  copiasIniciales,
  cuerpoDelPdf,
  guardarPapel,
  paginasDelPdf,
  papelGuardado,
  porHoja,
  problemasDelPapel,
  totalDeEtiquetas,
  type Cuadricula,
  type Elegida,
  type Formato,
  type Papel,
} from '../etiquetas/papel';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta } from '../ui/basicos';
import { formatoDia } from '../util/formato';
import { useRetrasado } from '../util/retrasado';
import { botonRedondo } from '../venta/ArmarVenta';

// Etiquetas con QR de las piezas, para el administrador en la bodega. Primero para el celular: se
// eligen piezas sueltas (buscando o escaneando), todo lo de la bodega o lo de una compra, con las
// copias de cada una; luego el papel (hoja carta con cuadrícula o una por página) y se imprime o se
// descarga el PDF. El PDF lo arma la API: el QR lleva solo el código; la etiqueta, el código y el
// nombre corto, sin precio.

type Origen = 'sueltas' | 'bodega' | 'compra';

const ORIGENES: { origen: Origen; titulo: string }[] = [
  { origen: 'sueltas', titulo: 'Piezas sueltas' },
  { origen: 'bodega', titulo: 'La bodega' },
  { origen: 'compra', titulo: 'Una compra' },
];

// ------------------------------------------------------------------------------ Piezas sueltas

/** El buscador y el escáner: tocar un resultado (o escanear su código) la agrega a la lista. */
function BuscarPiezas({ alAgregar }: { alAgregar: (pieza: PiezaEtiqueta) => void }) {
  const consultas = useQueryClient();
  const [texto, setTexto] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const buscado = useRetrasado(texto.trim());

  const buscar = (que: string) => ({
    queryKey: ['etiquetas', 'piezas', que],
    queryFn: () =>
      api<{ piezas: PiezaEtiqueta[] }>('GET', `/etiquetas/piezas?texto=${encodeURIComponent(que)}`),
  });
  const resultados = useQuery({ ...buscar(buscado), enabled: buscado.length >= 2 });

  const agregar = (pieza: PiezaEtiqueta) => {
    alAgregar(pieza);
    setTexto('');
    setAviso(`Agregada: ${pieza.nombre} (${pieza.codigo})`);
  };

  /** Un código escaneado o escrito entero: si es de una sola pieza, entra sin más toques. */
  const porCodigo = async (codigo: string) => {
    const limpio = codigo.trim();
    if (limpio.length < 2) return;
    setAviso(null);
    try {
      const { piezas } = await consultas.fetchQuery(buscar(limpio));
      const exacta =
        piezas.find((p) => p.codigo.toLowerCase() === limpio.toLowerCase()) ??
        (piezas.length === 1 ? piezas[0] : undefined);
      if (exacta) agregar(exacta);
      else setTexto(limpio); // se muestran los resultados (o que no hay) para elegir tocando
    } catch {
      setTexto(limpio);
    }
  };

  // Mientras se escribe, lo que hay en pantalla es de otra búsqueda: no se muestra
  const alDia = texto.trim() === buscado && buscado.length >= 2;
  const lista = alDia ? (resultados.data?.piezas ?? []) : [];

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          void porCodigo(texto);
        }}
      >
        <div className="flex-1">
          <Campo
            etiqueta="Buscar la pieza por nombre o código"
            name="buscar"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Labret, PTI-00012…"
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
      {aviso && <Aviso tipo="exito">{aviso}</Aviso>}

      {(resultados.isFetching || (texto.trim().length >= 2 && !alDia)) && (
        <Cargando texto="Buscando…" />
      )}
      {alDia && resultados.isError && (
        <Aviso tipo="error">{detalleDeError(resultados.error)}</Aviso>
      )}
      {alDia && resultados.isSuccess && lista.length === 0 && (
        <p className="py-2 text-center text-texto-secundario">
          No hay ninguna pieza con «{buscado}».
        </p>
      )}
      {lista.length > 0 && (
        <ul className="divide-y divide-borde border-t border-borde" aria-label="Resultados">
          {lista.map((p) => (
            <li key={p.variante_id}>
              <button
                type="button"
                onClick={() => agregar(p)}
                className="flex min-h-toque w-full items-center justify-between gap-3 py-3 text-left active:bg-esmeralda-claro"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{p.nombre}</span>
                  <span className="block text-sm text-texto-secundario">
                    {p.codigo} · {p.categoria}
                    {p.cantidad !== null && ` · en la bodega: ${p.cantidad}`}
                  </span>
                </span>
                <Plus className="size-5 shrink-0 text-esmeralda" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {texto.trim().length < 2 && !escaneando && !aviso && (
        <p className="flex items-center gap-2 text-sm text-texto-secundario">
          <Search className="size-4" aria-hidden /> Escriba al menos dos letras, o escanee el
          código.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- La lista elegida

/**
 * Las copias, para escribirlas: mientras se escribe se puede borrar el número (no salta a 1); al
 * salir del campo muestra las que quedaron.
 */
function CampoCopias({
  id,
  copias,
  minimo,
  alCambiar,
}: {
  id: string;
  copias: number;
  minimo: number;
  alCambiar: (copias: number) => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={minimo}
      max={COPIAS_MAXIMAS}
      value={texto ?? copias}
      onFocus={() => setTexto(String(copias))}
      onBlur={() => setTexto(null)}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isInteger(n)) alCambiar(n);
      }}
      className="min-h-toque w-20 rounded-xl border border-borde bg-superficie px-2 text-center text-lg font-semibold"
    />
  );
}

/** Cada pieza con sus copias: el «menos», el número (se puede escribir) y el «más». */
function ListaElegida({
  lista,
  alCambiar,
  alQuitar,
}: {
  lista: Elegida[];
  alCambiar: (varianteId: number, copias: number) => void;
  /** Solo en las piezas sueltas: en la bodega y en la compra, 0 copias es «esta no». */
  alQuitar?: (varianteId: number) => void;
}) {
  const minimo = alQuitar ? 1 : 0;
  const ajustar = (n: number) => Math.min(Math.max(Math.trunc(n) || 0, minimo), COPIAS_MAXIMAS);
  return (
    <ul className="divide-y divide-borde border-y border-borde" aria-label="Para imprimir">
      {lista.map(({ pieza, copias }) => (
        <li
          key={pieza.variante_id}
          className={`flex flex-col gap-2 py-3 ${copias === 0 ? 'opacity-60' : ''}`}
        >
          <div className="min-w-0">
            <p className="font-medium">{pieza.nombre}</p>
            <p className="text-sm text-texto-secundario">
              {pieza.codigo}
              {copias === 0 && ' · no se imprime'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={botonRedondo}
              aria-label={`Una menos de ${pieza.nombre}`}
              disabled={copias <= minimo}
              onClick={() => alCambiar(pieza.variante_id, ajustar(copias - 1))}
            >
              <Minus className="size-5" aria-hidden />
            </button>
            <label htmlFor={`copias-${pieza.variante_id}`} className="sr-only">
              Copias de {pieza.nombre}
            </label>
            <CampoCopias
              id={`copias-${pieza.variante_id}`}
              copias={copias}
              minimo={minimo}
              alCambiar={(n) => alCambiar(pieza.variante_id, ajustar(n))}
            />
            <button
              type="button"
              className={botonRedondo}
              aria-label={`Una más de ${pieza.nombre}`}
              disabled={copias >= COPIAS_MAXIMAS}
              onClick={() => alCambiar(pieza.variante_id, ajustar(copias + 1))}
            >
              <Plus className="size-5" aria-hidden />
            </button>
            {alQuitar && (
              <button
                type="button"
                className={`${botonRedondo} ml-auto`}
                aria-label={`Quitar ${pieza.nombre}`}
                onClick={() => alQuitar(pieza.variante_id)}
              >
                <Trash2 className="size-5" aria-hidden />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------- El papel

type CampoHoja = Exclude<keyof Cuadricula, 'bordes'>;
type CampoMedida = CampoHoja | 'rollo_ancho' | 'rollo_alto';
type Medidas = Record<CampoMedida, string>;

const CAMPOS_HOJA: { campo: CampoHoja; etiqueta: string }[] = [
  { campo: 'filas', etiqueta: 'Filas' },
  { campo: 'columnas', etiqueta: 'Columnas' },
  { campo: 'ancho', etiqueta: 'Ancho de la etiqueta (mm)' },
  { campo: 'alto', etiqueta: 'Alto de la etiqueta (mm)' },
  { campo: 'margen_superior', etiqueta: 'Margen de arriba (mm)' },
  { campo: 'margen_izquierdo', etiqueta: 'Margen de la izquierda (mm)' },
  { campo: 'separacion_horizontal', etiqueta: 'Entre columnas (mm)' },
  { campo: 'separacion_vertical', etiqueta: 'Entre filas (mm)' },
];

function aTextos(papel: Papel): Medidas {
  const { bordes: _bordes, ...hoja } = papel.hoja;
  return {
    ...(Object.fromEntries(Object.entries(hoja).map(([c, v]) => [c, String(v)])) as Record<
      CampoHoja,
      string
    >),
    rollo_ancho: String(papel.rollo.ancho),
    rollo_alto: String(papel.rollo.alto),
  };
}

/** Lo escrito como número (acepta la coma decimal); lo que no es un número queda NaN. */
const numero = (texto: string) =>
  texto.trim() === '' ? Number.NaN : Number(texto.trim().replace(',', '.'));

function dePapel(formato: Formato, medidas: Medidas, bordes: boolean): Papel {
  const hoja = Object.fromEntries(
    CAMPOS_HOJA.map(({ campo }) => [campo, numero(medidas[campo])]),
  ) as Record<CampoHoja, number>;
  return {
    formato,
    hoja: { ...hoja, saltar: numero(medidas.saltar), bordes },
    rollo: { ancho: numero(medidas.rollo_ancho), alto: numero(medidas.rollo_alto) },
  };
}

function ElegirPapel({
  formato,
  medidas,
  bordes,
  problemas,
  alCambiarFormato,
  alCambiar,
  alCambiarBordes,
}: {
  formato: Formato;
  medidas: Medidas;
  bordes: boolean;
  problemas: Record<string, string>;
  alCambiarFormato: (formato: Formato) => void;
  alCambiar: (cambios: Partial<Medidas>) => void;
  alCambiarBordes: (bordes: boolean) => void;
}) {
  const [cambiando, setCambiando] = useState(false);
  const hoja = dePapel('HOJA', medidas, bordes).hoja;
  const campo = (nombre: CampoMedida, etiqueta: string) => (
    <Campo
      key={nombre}
      etiqueta={etiqueta}
      name={nombre}
      inputMode="decimal"
      autoComplete="off"
      value={medidas[nombre]}
      error={problemas[nombre]}
      onChange={(e) => alCambiar({ [nombre]: e.target.value })}
    />
  );

  return (
    <Tarjeta className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Papel</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Papel</legend>
        {(
          [
            ['HOJA', 'Hoja carta', 'Hojas adhesivas, con su cuadrícula de etiquetas'],
            ['ROLLO', 'Una por página', 'Para la impresora de etiquetas (o el rollo de 80 mm)'],
          ] as const
        ).map(([valor, titulo, detalle]) => (
          <div
            key={valor}
            className={`flex min-h-toque items-center gap-3 rounded-xl border px-4 py-2 ${formato === valor ? 'border-esmeralda bg-esmeralda-claro' : 'border-borde'}`}
          >
            <input
              id={`papel-${valor}`}
              type="radio"
              name="formato"
              value={valor}
              checked={formato === valor}
              onChange={() => alCambiarFormato(valor)}
              aria-describedby={`papel-${valor}-detalle`}
              className="size-5 shrink-0 accent-esmeralda"
            />
            <label htmlFor={`papel-${valor}`} className="flex-1 cursor-pointer">
              <span className="block font-semibold">{titulo}</span>
              <span id={`papel-${valor}-detalle`} className="block text-sm text-texto-secundario">
                {detalle}
              </span>
            </label>
          </div>
        ))}
      </fieldset>

      {formato === 'ROLLO' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {campo('rollo_ancho', 'Ancho (mm)')}
            {campo('rollo_alto', 'Alto (mm)')}
          </div>
          <p className="text-sm text-texto-secundario">
            Cada etiqueta sale en su página, de ese tamaño. En la impresora elija el mismo tamaño de
            etiqueta.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm">
            {Number.isFinite(porHoja(hoja)) && porHoja(hoja) > 0
              ? `${hoja.columnas} × ${hoja.filas} etiquetas de ${hoja.ancho} × ${hoja.alto} mm: ${porHoja(hoja)} por hoja.`
              : 'Revise las medidas de la hoja.'}
          </p>
          {campo('saltar', 'Ya usadas en la primera hoja (se dejan en blanco)')}
          {cambiando ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {CAMPOS_HOJA.map(({ campo: nombre, etiqueta }) => campo(nombre, etiqueta))}
              </div>
              <div className="flex min-h-toque items-center gap-3">
                <input
                  id="bordes"
                  type="checkbox"
                  checked={bordes}
                  onChange={(e) => alCambiarBordes(e.target.checked)}
                  className="size-5 shrink-0 accent-esmeralda"
                />
                <label htmlFor="bordes">
                  Dibujar el contorno de cada etiqueta (para probar en papel normal)
                </label>
              </div>
              <Boton
                variante="texto"
                className="self-start px-3"
                onClick={() =>
                  alCambiar(
                    aTextos({ formato: 'HOJA', hoja: HOJA_DE_30, rollo: { ancho: 50, alto: 30 } }),
                  )
                }
              >
                Volver a la hoja de 30
              </Boton>
            </>
          ) : (
            <Boton variante="texto" className="self-start px-3" onClick={() => setCambiando(true)}>
              Cambiar las medidas de la hoja
            </Boton>
          )}
          {!cambiando && (problemas.filas || problemas.columnas) && (
            <Aviso tipo="error">{problemas.columnas ?? problemas.filas}</Aviso>
          )}
        </>
      )}
    </Tarjeta>
  );
}

// ------------------------------------------------------------------------------------ Pantalla

export function Etiquetas() {
  const sesion = useSesionActiva();
  const veCompras = tienePermiso(sesion, ['INVENTARIO_ENTRADA']);
  const origenes = ORIGENES.filter((o) => o.origen !== 'compra' || veCompras);
  const [origen, setOrigen] = useState<Origen>('sueltas');

  const [sueltas, setSueltas] = useState<Elegida[]>([]);
  const [copiasBodega, setCopiasBodega] = useState(new Map<number, number>());
  const [compraId, setCompraId] = useState<number | null>(null);
  const [copiasCompra, setCopiasCompra] = useState(new Map<number, number>());

  // El papel que se usó la última vez en este equipo
  const [inicial] = useState(papelGuardado);
  const [formato, setFormato] = useState<Formato>(inicial.formato);
  const [medidas, setMedidas] = useState<Medidas>(() => aTextos(inicial));
  const [bordes, setBordes] = useState(false);

  const bodega = useQuery({
    queryKey: ['etiquetas', 'bodega'],
    queryFn: () => api<{ piezas: PiezaEtiqueta[] }>('GET', '/etiquetas/bodega'),
    enabled: origen === 'bodega',
  });
  const compras = useQuery({
    queryKey: ['etiquetas', 'compras'],
    queryFn: () => api<{ compras: CompraParaEtiquetas[] }>('GET', '/etiquetas/compras'),
    enabled: origen === 'compra' && veCompras,
  });
  const compra = useQuery({
    queryKey: ['etiquetas', 'compra', compraId],
    queryFn: () =>
      api<{ compra: CompraParaEtiquetas; piezas: PiezaEtiqueta[] }>(
        'GET',
        `/etiquetas/compras/${compraId}`,
      ),
    enabled: origen === 'compra' && compraId !== null,
  });

  const conCopias = (piezas: PiezaEtiqueta[] | undefined, copias: Map<number, number>) =>
    (piezas ?? []).map((pieza) => ({
      pieza,
      copias: copias.get(pieza.variante_id) ?? copiasIniciales(pieza),
    }));
  const lista: Elegida[] =
    origen === 'sueltas'
      ? sueltas
      : origen === 'bodega'
        ? conCopias(bodega.data?.piezas, copiasBodega)
        : conCopias(compra.data?.piezas, copiasCompra);

  const cambiarCopias = (varianteId: number, copias: number) => {
    if (origen === 'sueltas') {
      setSueltas((antes) =>
        antes.map((e) => (e.pieza.variante_id === varianteId ? { ...e, copias } : e)),
      );
    } else {
      const cambiar = origen === 'bodega' ? setCopiasBodega : setCopiasCompra;
      cambiar((antes) => new Map(antes).set(varianteId, copias));
    }
  };

  const agregarSuelta = (pieza: PiezaEtiqueta) =>
    setSueltas((antes) =>
      antes.some((e) => e.pieza.variante_id === pieza.variante_id)
        ? antes.map((e) =>
            e.pieza.variante_id === pieza.variante_id
              ? { ...e, copias: Math.min(e.copias + 1, COPIAS_MAXIMAS) }
              : e,
          )
        : [...antes, { pieza, copias: 1 }],
    );

  const papel = dePapel(formato, medidas, bordes);
  const problemas = problemasDelPapel(papel);
  const total = totalDeEtiquetas(lista);
  const cuerpo = cuerpoDelPdf(lista, papel);
  const clave = JSON.stringify(cuerpo);

  // El PDF se pide una vez por lo elegido: imprimir otra vez lo mismo no lo vuelve a pedir
  const pedido = useRef<{ clave: string; pdf: Blob } | null>(null);
  const [ocupado, setOcupado] = useState<'imprimir' | 'preparar' | null>(null);
  const [resultado, setResultado] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(
    null,
  );
  const [archivo, setArchivo] = useState<{ clave: string; archivo: File; url: string } | null>(
    null,
  );
  useEffect(
    () => () => {
      if (archivo) URL.revokeObjectURL(archivo.url);
    },
    [archivo],
  );

  const pdf = async (): Promise<Blob> => {
    if (pedido.current?.clave === clave) return pedido.current.pdf;
    const blob = await apiArchivo('POST', '/etiquetas/pdf', { cuerpo });
    pedido.current = { clave, pdf: blob };
    guardarPapel(papel);
    return blob;
  };

  const describir = () => {
    const paginas = paginasDelPdf(total, papel);
    const de = papel.formato === 'HOJA' ? (paginas === 1 ? 'hoja' : 'hojas') : 'páginas';
    return `${total} ${total === 1 ? 'etiqueta' : 'etiquetas'} en ${paginas} ${papel.formato === 'HOJA' ? `${de} carta` : de}`;
  };

  const imprimir = async () => {
    setOcupado('imprimir');
    setResultado(null);
    try {
      await imprimirConDialogo(await pdf());
      setResultado({ tipo: 'exito', texto: `Se mandaron a imprimir ${describir()}.` });
    } catch (error) {
      setResultado({ tipo: 'error', texto: mensajeDeError(error) });
    } finally {
      setOcupado(null);
    }
  };

  const preparar = async () => {
    setOcupado('preparar');
    setResultado(null);
    try {
      const listo = new File([await pdf()], 'etiquetas.pdf', { type: 'application/pdf' });
      setArchivo({ clave, archivo: listo, url: URL.createObjectURL(listo) });
    } catch (error) {
      setResultado({ tipo: 'error', texto: mensajeDeError(error) });
    } finally {
      setOcupado(null);
    }
  };

  const listo = archivo?.clave === clave ? archivo : null;
  const puedeCompartir =
    listo !== null &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [listo.archivo] });
  const sePuede = total > 0 && Object.keys(problemas).length === 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Tags className="size-6 text-esmeralda" aria-hidden /> Etiquetas
        </h1>
        <p className="text-texto-secundario">
          El QR lleva solo el código de la pieza; la etiqueta, el código y el nombre. Sin precio.
        </p>
      </header>

      <div role="tablist" className="flex gap-1 rounded-2xl border border-borde bg-superficie p-1">
        {origenes.map((o) => (
          <button
            key={o.origen}
            type="button"
            role="tab"
            aria-selected={origen === o.origen}
            onClick={() => {
              setOrigen(o.origen);
              setResultado(null);
            }}
            className={`min-h-toque flex-1 rounded-xl px-2 text-sm font-semibold sm:text-base ${origen === o.origen ? 'bg-esmeralda text-white' : 'text-texto-secundario'}`}
          >
            {o.titulo}
          </button>
        ))}
      </div>

      <Tarjeta className="flex flex-col gap-3">
        {origen === 'sueltas' && (
          <>
            <BuscarPiezas alAgregar={agregarSuelta} />
            {sueltas.length > 0 && (
              <ListaElegida
                lista={sueltas}
                alCambiar={cambiarCopias}
                alQuitar={(id) =>
                  setSueltas((antes) => antes.filter((e) => e.pieza.variante_id !== id))
                }
              />
            )}
          </>
        )}

        {origen === 'bodega' && (
          <>
            <p className="text-sm text-texto-secundario">
              Todo lo que hay en la bodega: las copias de cada pieza son sus existencias. Cámbielas
              si hace falta (0: esa no se imprime).
            </p>
            {bodega.isPending && <Cargando />}
            {bodega.isError && <Aviso tipo="error">{detalleDeError(bodega.error)}</Aviso>}
            {bodega.isSuccess && lista.length === 0 && (
              <p className="py-2 text-center text-texto-secundario">La bodega está vacía.</p>
            )}
            {lista.length > 0 && <ListaElegida lista={lista} alCambiar={cambiarCopias} />}
          </>
        )}

        {origen === 'compra' && (
          <>
            {compras.isPending && <Cargando />}
            {compras.isError && <Aviso tipo="error">{detalleDeError(compras.error)}</Aviso>}
            {compras.isSuccess && compras.data.compras.length === 0 && (
              <p className="py-2 text-center text-texto-secundario">No hay compras registradas.</p>
            )}
            {compras.isSuccess && compras.data.compras.length > 0 && (
              <Selector
                etiqueta="Compra"
                name="compra"
                value={compraId ?? ''}
                onChange={(e) => {
                  setCompraId(e.target.value ? Number(e.target.value) : null);
                  setCopiasCompra(new Map());
                }}
              >
                <option value="">Elija la compra…</option>
                {compras.data.compras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.proveedor} · factura {c.factura_numero} · {formatoDia(c.fecha_factura)} ·{' '}
                    {c.piezas} piezas{c.estado === 'BORRADOR' ? ' (borrador)' : ''}
                  </option>
                ))}
              </Selector>
            )}
            {compraId !== null && (
              <p className="text-sm text-texto-secundario">
                Las copias de cada pieza son las que entraron con la compra. Cámbielas si hace falta
                (0: esa no se imprime).
              </p>
            )}
            {compraId !== null && compra.isPending && <Cargando />}
            {compra.isError && <Aviso tipo="error">{detalleDeError(compra.error)}</Aviso>}
            {lista.length > 0 && <ListaElegida lista={lista} alCambiar={cambiarCopias} />}
          </>
        )}

        {lista.length > 0 && (
          <p className="flex items-center justify-between gap-2 font-semibold">
            <span>Para imprimir</span>
            <Etiqueta tono={total > 0 ? 'oro' : 'neutro'}>
              {total} {total === 1 ? 'etiqueta' : 'etiquetas'}
            </Etiqueta>
          </p>
        )}
      </Tarjeta>

      <ElegirPapel
        formato={formato}
        medidas={medidas}
        bordes={bordes}
        problemas={problemas}
        alCambiarFormato={setFormato}
        alCambiar={(cambios) => setMedidas((antes) => ({ ...antes, ...cambios }))}
        alCambiarBordes={setBordes}
      />

      <Tarjeta className="flex flex-col gap-3">
        {sePuede ? (
          <p className="font-semibold">{describir()}</p>
        ) : (
          <p className="text-texto-secundario">
            {total === 0 ? 'Elija las piezas y sus copias.' : 'Revise las medidas del papel.'}
          </p>
        )}
        {resultado && <Aviso tipo={resultado.tipo}>{resultado.texto}</Aviso>}
        <Boton
          ancho
          disabled={!sePuede || ocupado !== null}
          ocupado={ocupado === 'imprimir'}
          onClick={() => void imprimir()}
        >
          <Printer className="size-5" aria-hidden /> Imprimir
        </Boton>
        {listo ? (
          puedeCompartir ? (
            <Boton
              variante="secundario"
              ancho
              onClick={() => {
                // Cerrar la hoja de compartir sin elegir nada no es un error
                void navigator
                  .share({ files: [listo.archivo], title: 'Etiquetas' })
                  .catch(() => undefined);
              }}
            >
              <Share2 className="size-5" aria-hidden /> Compartir el PDF
            </Boton>
          ) : (
            <a
              href={listo.url}
              download="etiquetas.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-toque items-center justify-center gap-2 rounded-xl border border-borde bg-superficie px-5 text-base font-semibold text-texto hover:bg-esmeralda-claro"
            >
              <Download className="size-5" aria-hidden /> Abrir el PDF
            </a>
          )
        ) : (
          <Boton
            variante="secundario"
            ancho
            disabled={!sePuede || ocupado !== null}
            ocupado={ocupado === 'preparar'}
            onClick={() => void preparar()}
          >
            <Download className="size-5" aria-hidden /> Preparar el PDF
          </Boton>
        )}
        <p className="text-sm text-texto-secundario">
          Al imprimir, elija la escala «Tamaño real» (o «Personalizado» 100): si el PDF se achica,
          las etiquetas no caen en su lugar.
        </p>
      </Tarjeta>
    </div>
  );
}
