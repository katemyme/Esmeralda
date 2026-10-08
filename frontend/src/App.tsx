import { useRegisterSW } from 'virtual:pwa-register/react';
import { Hammer } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Disposicion } from './disposicion/Disposicion';
import { MENU, estaLista } from './menu';
import { Acceso } from './pantallas/Acceso';
import { Alertas } from './pantallas/Alertas';
import { CambiarPassword } from './pantallas/CambiarPassword';
import { Inicio } from './pantallas/Inicio';
import { MiPin } from './pantallas/MiPin';
import { tienePermiso, useSesion, useSesionActiva } from './sesion/sesion';
import { Boton, Cargando, Tarjeta } from './ui/basicos';

// Aparte del resto: trae el lector de códigos y el codificador de la impresora, que pesan
const EsteEquipo = lazy(() =>
  import('./pantallas/EsteEquipo').then((modulo) => ({ default: modulo.EsteEquipo })),
);

const FASES = {
  F1: 'la base',
  F2a: 'la fase de caja y venta',
  F2b: 'la fase de devoluciones y cambios',
  F3: 'la fase de inventario',
  F3b: 'la fase de códigos y etiquetas',
  F4: 'la fase de administración',
  F5: 'la fase de reportes',
};

/** Una opción del menú que todavía no se construye, o una dirección que no existe. */
function EnConstruccion() {
  const sesion = useSesionActiva();
  const { pathname } = useLocation();
  const opcion = MENU.find((o) => o.ruta !== '/' && pathname.startsWith(o.ruta));
  if (!opcion || estaLista(opcion) || !tienePermiso(sesion, opcion.permisos)) {
    return <Navigate to="/" replace />;
  }
  const Icono = opcion.icono;
  return (
    <Tarjeta className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
      <Icono className="size-10 text-esmeralda" aria-hidden />
      <h1 className="text-xl font-semibold">{opcion.titulo}</h1>
      <p className="flex items-center gap-2 text-texto-secundario">
        <Hammer className="size-4" aria-hidden /> Esta pantalla llega con {FASES[opcion.fase]}.
      </p>
    </Tarjeta>
  );
}

/** Cuando hay una versión nueva de la app, se avisa y se actualiza con un toque. */
function AvisoDeVersion() {
  const {
    needRefresh: [hayVersion],
    updateServiceWorker,
  } = useRegisterSW();
  if (!hayVersion) return null;
  return (
    <div className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-borde bg-superficie p-4 shadow-xl md:bottom-4">
      <p className="flex-1 font-medium">Hay una versión nueva de la aplicación.</p>
      <Boton onClick={() => void updateServiceWorker(true)}>Actualizar</Boton>
    </div>
  );
}

function Contenido() {
  const { estado } = useSesion();
  if (estado.fase === 'cargando') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Cargando />
      </div>
    );
  }
  if (estado.fase === 'fuera') return <Acceso pantalla={estado.pantalla} />;
  if (estado.sesion.usuario.debe_cambiar_password) return <CambiarPassword />;
  return (
    <Routes>
      <Route element={<Disposicion />}>
        <Route index element={<Inicio />} />
        <Route path="alertas" element={<Alertas />} />
        <Route
          path="equipo"
          element={
            <Suspense fallback={<Cargando />}>
              <EsteEquipo />
            </Suspense>
          }
        />
        <Route path="mi-pin" element={<MiPin />} />
        <Route path="*" element={<EnConstruccion />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Contenido />
      <AvisoDeVersion />
    </BrowserRouter>
  );
}
