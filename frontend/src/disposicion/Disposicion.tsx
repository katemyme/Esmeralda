import { Bell, KeyRound, Lock, LogOut, Menu as IconoMenu, Power, UserRound, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { usePendientes, useTipoCambio, useTurno } from '../api/consultas';
import { estaLista, opcionesPara, type OpcionMenu } from '../menu';
import { useSesion, useSesionActiva } from '../sesion/sesion';
import { EspacioLogo, Etiqueta, Marca } from '../ui/basicos';
import { Confirmacion } from '../ui/Confirmacion';
import { primerNombre } from '../util/formato';

/** Con un turno abierto: siempre a la vista la sucursal, la caja y el tipo de cambio del día. */
function FranjaDeCaja() {
  const turno = useTurno();
  const tipoCambio = useTipoCambio();
  if (!turno) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-esmeralda px-4 py-1.5 text-sm text-white">
      <span className="font-semibold">{turno.sucursal.nombre}</span>
      <span aria-hidden>·</span>
      <span>{turno.caja.nombre}</span>
      <span aria-hidden>·</span>
      {tipoCambio?.es_de_hoy ? (
        <span>US$ 1 = C$ {Number(tipoCambio.usd_a_nio).toFixed(2)}</span>
      ) : (
        <Etiqueta tono="aviso">Falta el tipo de cambio de hoy</Etiqueta>
      )}
    </div>
  );
}

function EnlaceMenu({ opcion, alElegir }: { opcion: OpcionMenu; alElegir?: () => void }) {
  const Icono = opcion.icono;
  return (
    <NavLink
      to={opcion.ruta}
      end={opcion.ruta === '/'}
      onClick={alElegir}
      className={({ isActive }) =>
        `flex min-h-toque items-center gap-3 rounded-xl px-3 font-medium ${isActive ? 'bg-esmeralda-claro text-esmeralda' : 'text-texto hover:bg-fondo'}`
      }
    >
      <Icono className="size-5 shrink-0" aria-hidden />
      <span className="flex-1">{opcion.titulo}</span>
      {!estaLista(opcion) && <Etiqueta>Pronto</Etiqueta>}
    </NavLink>
  );
}

function MenuDeUsuario({ alCerrarEquipo }: { alCerrarEquipo: () => void }) {
  const { usuario, equipo } = useSesionActiva();
  const { bloquear } = useSesion();
  const navegar = useNavigate();
  const opcion =
    'flex min-h-toque cursor-pointer items-center gap-3 rounded-xl px-3 font-medium text-texto outline-none data-[highlighted]:bg-esmeralda-claro';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Menú de ${usuario.nombre_completo}`}
        className="flex min-h-toque items-center gap-2 rounded-xl px-2 font-medium hover:bg-esmeralda"
      >
        <UserRound className="size-6" aria-hidden />
        <span className="hidden max-w-32 truncate sm:inline">
          {primerNombre(usuario.nombre_completo)}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-2xl border border-borde bg-superficie p-2 shadow-xl"
        >
          <div className="px-3 py-2">
            <p className="font-semibold">{usuario.nombre_completo}</p>
            <p className="text-sm text-texto-secundario">{usuario.rol.nombre}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-borde" />
          {usuario.rol.codigo !== 'ADMIN' && (
            <DropdownMenu.Item className={opcion} onSelect={() => void navegar('/mi-pin')}>
              <KeyRound className="size-5" aria-hidden /> Mi PIN
            </DropdownMenu.Item>
          )}
          {equipo && (
            <DropdownMenu.Item className={opcion} onSelect={alCerrarEquipo}>
              <Power className="size-5" aria-hidden /> Cerrar el equipo
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={opcion} onSelect={() => void bloquear()}>
            <LogOut className="size-5" aria-hidden /> Cerrar sesión
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** El marco de todas las pantallas: barra superior, menú (al lado en tablet, abajo en celular). */
export function Disposicion() {
  const sesion = useSesionActiva();
  const { bloquear, cerrarEquipo } = useSesion();
  const pendientes = usePendientes();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const opciones = opcionesPara(sesion);
  // Abajo, en el celular: lo que ya funciona y más se usa; lo demás, en «Más»
  const principales = opciones.filter(estaLista).slice(0, 3);
  const boton = 'flex size-12 items-center justify-center rounded-xl hover:bg-esmeralda';

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-esmeralda-oscuro pt-[env(safe-area-inset-top)] text-white">
        <div className="flex min-h-14 items-center gap-3 px-3 sm:px-4">
          <EspacioLogo className="size-9" />
          <Link to="/" className="truncate text-lg">
            <Marca sobreOscuro />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            {sesion.equipo && (
              <button
                type="button"
                className={boton}
                aria-label="Bloquear la pantalla"
                onClick={() => void bloquear()}
              >
                <Lock className="size-6" aria-hidden />
              </button>
            )}
            <Link
              to="/alertas"
              className={`relative ${boton}`}
              aria-label={pendientes > 0 ? `Alertas: ${pendientes} pendientes` : 'Alertas'}
            >
              <Bell className="size-6" aria-hidden />
              {pendientes > 0 && (
                <span className="absolute top-1.5 right-1 min-w-5 rounded-full bg-aviso px-1 text-center text-xs font-bold">
                  {pendientes > 99 ? '99+' : pendientes}
                </span>
              )}
            </Link>
            <MenuDeUsuario alCerrarEquipo={() => setConfirmarCierre(true)} />
          </div>
        </div>
        <FranjaDeCaja />
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Menú"
          className="hidden w-64 shrink-0 flex-col gap-1 border-r border-borde bg-superficie p-3 md:flex"
        >
          {opciones.map((opcion) => (
            <EnlaceMenu key={opcion.ruta} opcion={opcion} />
          ))}
        </nav>
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-28 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Menú"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {principales.map((opcion) => {
          const Icono = opcion.icono;
          return (
            <NavLink
              key={opcion.ruta}
              to={opcion.ruta}
              end={opcion.ruta === '/'}
              className={({ isActive }) =>
                `flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${isActive ? 'text-esmeralda' : 'text-texto-secundario'}`
              }
            >
              <Icono className="size-6" aria-hidden />
              {opcion.titulo}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setMenuAbierto(true)}
          className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-texto-secundario"
        >
          <IconoMenu className="size-6" aria-hidden />
          Más
        </button>
      </nav>

      {menuAbierto && (
        <dialog
          open
          aria-label="Menú completo"
          className="fixed inset-0 z-40 m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-superficie p-0 md:hidden"
        >
          <div className="flex min-h-14 items-center justify-between border-b border-borde px-4 pt-[env(safe-area-inset-top)]">
            <h2 className="text-lg font-semibold">Menú</h2>
            <button
              type="button"
              aria-label="Cerrar el menú"
              className="flex size-12 items-center justify-center rounded-xl"
              onClick={() => setMenuAbierto(false)}
            >
              <X className="size-6" aria-hidden />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
            {opciones.map((opcion) => (
              <EnlaceMenu
                key={opcion.ruta}
                opcion={opcion}
                alElegir={() => setMenuAbierto(false)}
              />
            ))}
          </div>
        </dialog>
      )}

      <Confirmacion
        abierta={confirmarCierre}
        alCerrar={() => setConfirmarCierre(false)}
        titulo="¿Cerrar el equipo?"
        textoConfirmar="Cerrar el equipo"
        ocupado={cerrando}
        alConfirmar={() => {
          setCerrando(true);
          void cerrarEquipo().finally(() => setCerrando(false));
        }}
      >
        Es para el final del día. Se cierran todas las sesiones de este equipo y deja de aceptar el
        PIN: mañana, la primera persona entra con su usuario y contraseña.
      </Confirmacion>
    </div>
  );
}
