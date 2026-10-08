import { Bell, KeyRound, Smartphone, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { usePendientes, useTurno } from '../api/consultas';
import { useSesionActiva } from '../sesion/sesion';
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
  const { usuario, equipo, acceso } = useSesionActiva();
  const pendientes = usePendientes();
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
            solicitar devoluciones y vender. Abrir y cerrar la caja, anular y lo demás se hace en la
            tablet de la sucursal.
          </p>
        </Aviso>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
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
