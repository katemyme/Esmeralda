import { Banknote, Bell, KeyRound, ShoppingCart, Smartphone, Undo2, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { usePendientes, usePorAprobar, usePorTransferir, useTurno } from '../api/consultas';
import { tienePermiso, useSesionActiva } from '../sesion/sesion';
import { Aviso, Tarjeta } from '../ui/basicos';
import { formatoHora, primerNombre } from '../util/formato';

function Acceso({
  a,
  icono,
  titulo,
  children,
}: {
  a: string;
  icono: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <Link to={a} className="block rounded-2xl focus-visible:outline-offset-4">
      <Tarjeta className="flex h-full items-start gap-4 active:bg-esmeralda-claro">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-esmeralda-claro text-esmeralda">
          {icono}
        </span>
        <span>
          <span className="block font-semibold">{titulo}</span>
          <span className="block text-texto-secundario">{children}</span>
        </span>
      </Tarjeta>
    </Link>
  );
}

export function Inicio() {
  const sesion = useSesionActiva();
  const { usuario, equipo, acceso } = sesion;
  const pendientes = usePendientes();
  const porAprobar = usePorAprobar();
  const transferencias = usePorTransferir();
  const turno = useTurno();
  const esAdmin = usuario.rol.codigo === 'ADMIN';

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Hola, {primerNombre(usuario.nombre_completo)}</h1>
        <p className="text-texto-secundario">
          {usuario.rol.nombre}
          {usuario.sucursales.length > 0 &&
            ` · ${usuario.sucursales.map((s) => s.nombre).join(', ')}`}
        </p>
      </header>

      {acceso === 'CELULAR' && (
        <Aviso tipo="info">
          <p className="flex items-center gap-2 font-semibold">
            <Smartphone className="size-4" aria-hidden /> Está en su celular
          </p>
          <p className="mt-1 font-normal">
            Desde aquí puede consultar precios y existencias, recibir envíos, hacer conteos,
            solicitar devoluciones y vender. Abrir y cerrar la caja, anular y lo demás se hace en el
            equipo de la sucursal.
          </p>
        </Aviso>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {tienePermiso(sesion, ['VENTAS_REGISTRAR']) && (
          <Acceso
            a="/venta"
            icono={<ShoppingCart className="size-6" aria-hidden />}
            titulo="Vender"
          >
            Buscar o escanear, cobrar y entregar el ticket.
          </Acceso>
        )}
        {tienePermiso(sesion, ['DEVOLUCIONES_REGISTRAR', 'DEVOLUCIONES_APROBAR']) && (
          <Acceso
            a="/devoluciones"
            icono={<Undo2 className="size-6" aria-hidden />}
            titulo="Devoluciones"
          >
            {porAprobar === null
              ? 'Solicitar una devolución o un cambio y ver las de su sucursal.'
              : porAprobar === 0
                ? 'No hay ninguna por aprobar.'
                : porAprobar === 1
                  ? 'Hay 1 por aprobar.'
                  : `Hay ${porAprobar} por aprobar.`}
          </Acceso>
        )}
        {transferencias !== null && (
          <Acceso
            a="/devoluciones/transferencias"
            icono={<Banknote className="size-6" aria-hidden />}
            titulo="Transferencias pendientes"
          >
            {transferencias === 0
              ? 'No hay ninguna transferencia de devoluciones por hacer.'
              : transferencias === 1
                ? 'Hay 1 por hacer.'
                : `Hay ${transferencias} por hacer.`}
          </Acceso>
        )}
        <Acceso a="/alertas" icono={<Bell className="size-6" aria-hidden />} titulo="Alertas">
          {pendientes === 0
            ? 'No tiene nada pendiente.'
            : pendientes === 1
              ? 'Tiene 1 pendiente.'
              : `Tiene ${pendientes} pendientes.`}
        </Acceso>

        {equipo && (
          <Tarjeta className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-esmeralda-claro text-esmeralda">
              <Wallet className="size-6" aria-hidden />
            </span>
            <span>
              <span className="block font-semibold">Caja</span>
              {/* Solo el estado: los montos del turno no se muestran (el arqueo es a ciegas) */}
              <span className="block text-texto-secundario">
                {turno
                  ? `${turno.caja.nombre} abierta desde las ${formatoHora(turno.fecha_apertura)} por ${primerNombre(turno.abierto_por.nombre_completo)}.`
                  : 'No hay un turno abierto en este equipo.'}
              </span>
            </span>
          </Tarjeta>
        )}

        {!esAdmin && usuario.pin !== 'ACTIVO' && (
          <Acceso
            a="/mi-pin"
            icono={<KeyRound className="size-6" aria-hidden />}
            titulo={usuario.pin === 'BLOQUEADO' ? 'Su PIN está bloqueado' : 'Cree su PIN'}
          >
            {usuario.pin === 'BLOQUEADO'
              ? 'Cree uno nuevo para volver a entrar rápido en la tablet.'
              : 'Con un PIN de 4 dígitos entra en la tablet sin escribir su contraseña.'}
          </Acceso>
        )}
      </div>
    </div>
  );
}
