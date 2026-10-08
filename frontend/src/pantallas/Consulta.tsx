import { useQuery } from '@tanstack/react-query';
import { ScanLine, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, detalleDeError } from '../api/cliente';
import type { ExistenciaUbicacion, SucursalConCajas, VarianteEncontrada } from '../api/tipos';
import { EscanerCamara } from '../equipo/EscanerCamara';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta } from '../ui/basicos';
import { formatoMonto } from '../util/formato';

/** Espera a que la persona deje de escribir antes de buscar. */
function useRetrasado(valor: string, ms = 300): string {
  const [retrasado, setRetrasado] = useState(valor);
  useEffect(() => {
    const reloj = window.setTimeout(() => setRetrasado(valor), ms);
    return () => window.clearTimeout(reloj);
  }, [valor, ms]);
  return retrasado;
}

/** Cuánto hay de un producto en cada ubicación (la bodega, según lo que cada quien puede ver). */
function Existencias({ varianteId }: { varianteId: number }) {
  const consulta = useQuery({
    queryKey: ['existencias', varianteId],
    queryFn: () =>
      api<{ existencias: ExistenciaUbicacion[] }>('GET', `/variantes/${varianteId}/existencias`),
  });
  if (consulta.isPending) return <Cargando texto="Buscando existencias…" />;
  if (consulta.isError) return <Aviso tipo="error">{detalleDeError(consulta.error)}</Aviso>;
  return (
    <ul className="mt-3 divide-y divide-borde border-t border-borde">
      {consulta.data.existencias.map((e) => (
        <li key={e.sucursal_id} className="flex justify-between gap-3 py-2">
          <span>{e.sucursal}</span>
          <span className="font-semibold">
            {e.cantidad === null ? (e.disponible === false ? 'No hay' : 'Sí hay') : e.cantidad}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Precios y existencias. Se busca escribiendo el nombre o el código, o escaneando el código con la
 * cámara: el escáner es el camino rápido, el buscador siempre está.
 */
export function Consulta() {
  const sesion = useSesionActiva();
  const [texto, setTexto] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const buscado = useRetrasado(texto.trim());
  const veExistencias = tienePermiso(sesion, ['INVENTARIO_VER']);

  const sucursales = useQuery({
    queryKey: ['sucursales'],
    queryFn: () => api<{ sucursales: SucursalConCajas[] }>('GET', '/sucursales'),
  });
  const deVenta = (sucursales.data?.sucursales ?? []).filter(
    (s) => s.activa && s.tipo === 'SUCURSAL',
  );
  const [elegida, setElegida] = useState<number | null>(sesion.equipo?.sucursal.id ?? null);
  const sucursalId = elegida ?? deVenta[0]?.id ?? null;

  const resultados = useQuery({
    queryKey: ['consulta', buscado, sucursalId],
    queryFn: () =>
      api<{ variantes: VarianteEncontrada[] }>(
        'GET',
        `/variantes/buscar?texto=${encodeURIComponent(buscado)}&limite=30${sucursalId ? `&sucursal_id=${sucursalId}` : ''}`,
      ),
    enabled: buscado.length >= 2,
  });

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Precios y existencias</h1>
      </header>

      <Tarjeta className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Campo
              etiqueta="Buscar por nombre o código"
              name="buscar"
              type="search"
              autoComplete="off"
              placeholder="Cadena, PTI-00012…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
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
        </div>
        {escaneando && (
          <EscanerCamara
            alLeer={(codigo) => {
              setTexto(codigo);
              setEscaneando(false);
            }}
          />
        )}
        {deVenta.length > 1 && (
          <Selector
            etiqueta="Existencias en"
            name="sucursal"
            value={sucursalId ?? ''}
            onChange={(e) => setElegida(Number(e.target.value))}
          >
            {deVenta.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Selector>
        )}
      </Tarjeta>

      {buscado.length < 2 && (
        <p className="flex items-center justify-center gap-2 py-6 text-texto-secundario">
          <Search className="size-5" aria-hidden /> Escriba al menos dos letras, o escanee un
          código.
        </p>
      )}
      {resultados.isFetching && <Cargando texto="Buscando…" />}
      {resultados.isError && <Aviso tipo="error">{detalleDeError(resultados.error)}</Aviso>}
      {resultados.data?.variantes.length === 0 && (
        <Tarjeta className="text-center text-texto-secundario">
          No hay ningún producto con «{buscado}».
        </Tarjeta>
      )}

      <ul className="flex flex-col gap-3">
        {resultados.data?.variantes.map((v) => (
          <li key={v.id}>
            <Tarjeta>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {v.producto}
                    {v.variante !== 'Única' && ` — ${v.variante}`}
                  </p>
                  <p className="text-sm text-texto-secundario">
                    {v.sku} · {v.categoria}
                    {v.gama && ` · ${v.gama}`}
                  </p>
                </div>
                <p className="text-right text-lg font-semibold whitespace-nowrap">
                  {v.precio === null ? 'Según la pieza' : formatoMonto(v.precio)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {v.stock === null ? (
                  <Etiqueta>{v.tipo === 'PAQUETE' ? 'Perforación con pieza' : 'Servicio'}</Etiqueta>
                ) : v.stock > 0 ? (
                  <Etiqueta tono="exito">Hay {v.stock}</Etiqueta>
                ) : (
                  <Etiqueta tono="aviso">Sin existencias aquí</Etiqueta>
                )}
                {veExistencias && v.stock !== null && (
                  <Boton
                    variante="texto"
                    aria-expanded={abierta === v.id}
                    onClick={() => setAbierta(abierta === v.id ? null : v.id)}
                  >
                    {abierta === v.id ? 'Ocultar' : 'Ver en todas las ubicaciones'}
                  </Boton>
                )}
              </div>
              {abierta === v.id && <Existencias varianteId={v.id} />}
            </Tarjeta>
          </li>
        ))}
      </ul>
    </div>
  );
}
