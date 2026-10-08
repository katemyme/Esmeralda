import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, detalleDeError } from '../api/cliente';
import type { TurnoDetalle, TurnoResumen } from '../api/tipos';
import { BotonImprimir } from '../equipo/BotonImprimir';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Tarjeta } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { formatoFechaHora, formatoMonto } from '../util/formato';

// El historial de turnos, con lo esperado, lo contado y las diferencias. Solo para quien tiene
// CAJA_VER_DIFERENCIAS (la encargada y el administrador): es lo único que muestra esos montos.

const hayDiferencia = (monto: string | null) => monto !== null && Number(monto) !== 0;

/** Una diferencia de caja: en ámbar, con su signo (falta o sobra). */
function Diferencia({ monto, moneda }: { monto: string | null; moneda: 'NIO' | 'USD' }) {
  if (!hayDiferencia(monto)) return null;
  const valor = Number(monto);
  return (
    <Etiqueta tono="aviso">
      {valor < 0 ? 'Faltan' : 'Sobran'} {formatoMonto(Math.abs(valor), moneda)}
    </Etiqueta>
  );
}

function Volver({ a, texto }: { a: string; texto: string }) {
  return (
    <Link
      to={a}
      className="flex min-h-toque items-center gap-2 self-start rounded-xl px-2 font-medium text-esmeralda"
    >
      <ArrowLeft className="size-5" aria-hidden /> {texto}
    </Link>
  );
}

export function Turnos() {
  const lista = useQuery({
    queryKey: ['caja', 'turnos'],
    queryFn: () => api<{ turnos: TurnoResumen[] }>('GET', '/turnos?limite=50'),
  });

  return (
    <div className="flex flex-col gap-4">
      <Volver a="/caja" texto="Caja" />
      <header>
        <h1 className="text-2xl font-semibold">Historial de turnos</h1>
        <p className="text-texto-secundario">Los más recientes primero.</p>
      </header>
      {lista.isPending && <Cargando />}
      {lista.isError && <Aviso tipo="error">{detalleDeError(lista.error)}</Aviso>}
      {lista.data?.turnos.length === 0 && <Tarjeta>Todavía no hay turnos.</Tarjeta>}
      <ul className="flex flex-col gap-3">
        {lista.data?.turnos.map((t) => (
          <li key={t.id}>
            <Link to={`/caja/turnos/${t.id}`} className="block rounded-2xl">
              <Tarjeta className="flex flex-col gap-2 active:bg-esmeralda-claro">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {t.sucursal.nombre} · {t.caja.nombre}
                  </span>
                  {t.estado === 'ABIERTO' ? (
                    <Etiqueta tono="exito">Abierto</Etiqueta>
                  ) : (
                    <Etiqueta>Cerrado</Etiqueta>
                  )}
                  {t.cierre_forzado && <Etiqueta tono="aviso">Cierre forzado</Etiqueta>}
                  <Diferencia monto={t.diferencia_nio} moneda="NIO" />
                  <Diferencia monto={t.diferencia_usd} moneda="USD" />
                </div>
                <p className="text-sm text-texto-secundario">
                  Abrió {t.abierto_por.nombre_completo} el {formatoFechaHora(t.fecha_apertura)}
                  {t.fecha_cierre &&
                    ` · Cerró ${t.cerrado_por?.nombre_completo ?? ''} el ${formatoFechaHora(t.fecha_cierre)}`}
                </p>
                <p className="text-sm">
                  {t.ventas} {t.ventas === 1 ? 'venta' : 'ventas'} · {formatoMonto(t.total_vendido)}
                </p>
              </Tarjeta>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Turno() {
  const { id } = useParams();
  const sesion = useSesionActiva();
  const consultas = useQueryClient();
  const [forzar, setForzar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const detalle = useQuery({
    queryKey: ['caja', 'turnos', id],
    queryFn: () => api<{ turno: TurnoDetalle }>('GET', `/turnos/${id}`),
  });
  const cierreForzado = useMutation({
    mutationFn: () =>
      api('POST', `/turnos/${id}/cierre-forzado`, { cuerpo: { motivo: motivo.trim() } }),
    onSuccess: async () => {
      setForzar(false);
      await consultas.invalidateQueries({ queryKey: ['caja'] });
      await consultas.invalidateQueries({ queryKey: ['turno'] });
    },
  });
  const t = detalle.data?.turno;

  return (
    <div className="flex flex-col gap-4">
      <Volver a="/caja/turnos" texto="Historial de turnos" />
      {detalle.isPending && <Cargando />}
      {detalle.isError && <Aviso tipo="error">{detalleDeError(detalle.error)}</Aviso>}
      {t && (
        <>
          <header className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">
              {t.sucursal.nombre} · {t.caja.nombre}
            </h1>
            {t.estado === 'ABIERTO' ? (
              <Etiqueta tono="exito">Abierto</Etiqueta>
            ) : (
              <Etiqueta>Cerrado</Etiqueta>
            )}
            {t.cierre_forzado && <Etiqueta tono="aviso">Cierre forzado</Etiqueta>}
          </header>
          <p className="text-texto-secundario">
            Abrió {t.abierto_por.nombre_completo} el {formatoFechaHora(t.fecha_apertura)}
            {t.fecha_cierre &&
              ` · Cerró ${t.cerrado_por?.nombre_completo ?? ''} el ${formatoFechaHora(t.fecha_cierre)}`}
            {` · ${t.ventas} ${t.ventas === 1 ? 'venta' : 'ventas'}, ${formatoMonto(t.total_vendido)}`}
          </p>

          <Tarjeta className="overflow-x-auto">
            <h2 className="mb-3 text-lg font-semibold">Arqueo</h2>
            <table className="w-full min-w-[26rem] text-left">
              <thead className="text-sm text-texto-secundario">
                <tr>
                  <th className="py-2 font-medium">Método</th>
                  <th className="py-2 text-right font-medium">Esperado</th>
                  <th className="py-2 text-right font-medium">Contado</th>
                  <th className="py-2 text-right font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {t.arqueo.map((a) => {
                  const moneda = a.moneda === 'USD' ? 'USD' : 'NIO';
                  return (
                    <tr key={`${a.metodo.codigo}-${a.moneda}`}>
                      <td className="py-2">
                        {a.metodo.nombre} {a.moneda === 'USD' ? 'US$' : 'C$'}
                      </td>
                      <td className="py-2 text-right">{formatoMonto(a.esperado, moneda)}</td>
                      <td className="py-2 text-right">
                        {a.contado === null ? '—' : formatoMonto(a.contado, moneda)}
                      </td>
                      <td
                        className={`py-2 text-right font-semibold ${hayDiferencia(a.diferencia) ? 'text-aviso' : ''}`}
                      >
                        {a.diferencia === null ? '—' : formatoMonto(a.diferencia, moneda)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {t.intentos_cierre > 0 && (
              <p className="mt-3 text-sm text-aviso">Hubo un reconteo antes de cerrar.</p>
            )}
            {t.justificacion_diferencia && (
              <p className="mt-2">
                <span className="font-medium">Justificación:</span> {t.justificacion_diferencia}
              </p>
            )}
          </Tarjeta>

          {t.movimientos.length > 0 && (
            <Tarjeta>
              <h2 className="mb-2 text-lg font-semibold">Entradas y salidas de efectivo</h2>
              <ul className="divide-y divide-borde">
                {t.movimientos.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3 py-2">
                    <span>
                      {m.motivo}{' '}
                      <span className="text-sm text-texto-secundario">
                        · {m.usuario.nombre_completo}
                      </span>
                    </span>
                    <span className="font-semibold whitespace-nowrap">
                      {m.tipo === 'EGRESO' ? '− ' : '+ '}
                      {formatoMonto(m.monto, m.moneda)}
                    </span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {t.estado === 'CERRADO' ? (
            <BotonImprimir
              ruta={`/turnos/${t.id}/imprimir`}
              texto="Reimprimir el cierre (sale como copia)"
            />
          ) : (
            tienePermiso(sesion, ['CAJA_CIERRE_FORZADO']) && (
              <Boton variante="peligro" onClick={() => setForzar(true)}>
                Cierre forzado
              </Boton>
            )
          )}
          {cierreForzado.isError && (
            <Aviso tipo="error">{detalleDeError(cierreForzado.error)}</Aviso>
          )}

          <Confirmacion
            abierta={forzar}
            alCerrar={() => setForzar(false)}
            titulo="¿Cerrar este turno sin arqueo?"
            textoConfirmar="Cerrar sin arqueo"
            peligro
            ocupado={cierreForzado.isPending}
            alConfirmar={() => cierreForzado.mutate()}
          >
            <p className="mb-3">
              Es para un turno que nadie cerró. Se da por bueno lo que el sistema espera, sin contar
              el efectivo.
            </p>
            <Campo
              etiqueta="Motivo"
              name="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Confirmacion>
        </>
      )}
    </div>
  );
}
