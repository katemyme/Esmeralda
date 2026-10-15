import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/cliente';
import { useTipoCambio } from '../api/consultas';
import type { CajaAbierta, MetodoPago, PromocionDisponible, VentaDetalle } from '../api/tipos';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Cargando, Etiqueta, Selector, Tarjeta } from '../ui/basicos';
import { aCentavos, deCentavos, nuevoUuid } from '../util/dinero';
import { formatoMonto } from '../util/formato';
import { ArmarVenta, pesos, useArmado } from '../venta/ArmarVenta';
import { itemsDeVenta, nuevoPago, pagosDeVenta, subtotal, type Pago } from '../venta/carrito';
import { Cobro, Fila } from '../venta/Cobro';
import { useDestinoDeVenta, type Destino } from '../venta/destino';
import { VentaHecha } from '../venta/VentaHecha';

// Vender. Primero para el celular: se busca o se escanea, se arma la venta, se cobra y sale el
// ticket. El precio establecido, la promoción, las existencias y el vuelto son de la base: la
// pantalla suma lo que va en el carrito para mostrar el total antes de registrar la venta.

type Listo = Extract<Destino, { estado: 'listo' }>;

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
  const armado = useArmado();
  const { lineas, paquete } = armado;
  const [paso, setPaso] = useState<'carrito' | 'cobro'>('carrito');
  const [promocionId, setPromocionId] = useState<number | null>(null);
  const [pagos, setPagos] = useState<Pago[]>(() => [nuevoPago('EFECTIVO')]);
  const [cliente, setCliente] = useState({ nombre: '', telefono: '' });
  // La misma clave en cada intento de esta venta: si la respuesta se pierde, reintentar no duplica
  const [clave] = useState(nuevoUuid);
  const puedeSubir = tienePermiso(sesion, ['VENTAS_MODIFICAR_PRECIO']);
  const puedePromocion = tienePermiso(sesion, ['VENTAS_PROMOCION']);

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

  if (paso === 'cobro') {
    return (
      <Cobro
        total={total}
        pagos={pagos}
        metodos={metodos.data?.metodos_pago ?? []}
        usdANio={tipoCambio?.usd_a_nio ?? null}
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

      <ArmarVenta
        armado={armado}
        sucursalId={destino.sucursal.id}
        puedeSubir={puedeSubir}
        vacia="La venta está vacía. Busque o escanee lo que se lleva la clienta."
      />

      {lineas.length > 0 && (
        <>
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
