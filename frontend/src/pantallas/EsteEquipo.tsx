import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Camera, Download, Printer, Sun, TabletSmartphone } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { api, mensajeDeError } from '../api/cliente';
import type { Equipo, SucursalConCajas } from '../api/tipos';
import { EscanerCamara } from '../equipo/EscanerCamara';
import { useDespierta } from '../equipo/despierta';
import {
  conectarImpresora,
  impresoraLista,
  imprimirPorUsb,
  modoDeImpresion,
} from '../equipo/imprimir';
import { mensajeDeImpresora, navegadorImprimePorUsb, paginaDePrueba } from '../equipo/impresora';
import { tienePermiso, useSesion, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Etiqueta, Selector, Tarjeta } from '../ui/basicos';
import { formatoFechaHora } from '../util/formato';

function Seccion({
  icono,
  titulo,
  children,
}: {
  icono: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <Tarjeta className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {icono}
        {titulo}
      </h2>
      {children}
    </Tarjeta>
  );
}

const TIPOS_DE_EQUIPO = { CAJA: 'Caja', TABLET: 'Tablet', MOVIL: 'Celular' } as const;

const esquemaRegistro = z
  .object({
    nombre: z.string().trim().min(3, 'Póngale un nombre (mínimo 3 letras)').max(60),
    tipo: z.enum(['CAJA', 'TABLET', 'MOVIL']),
    sucursal_id: z.coerce.number<string>().int().positive('Elija la sucursal'),
    caja_id: z.string(),
  })
  .refine((d) => d.tipo !== 'CAJA' || d.caja_id !== '', {
    path: ['caja_id'],
    message: 'Elija la caja de este equipo',
  });

/** Solo el administrador: deja este navegador registrado como equipo de una sucursal. */
function RegistrarEquipo({ alRegistrar }: { alRegistrar: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const sucursales = useQuery({
    queryKey: ['sucursales'],
    queryFn: () => api<{ sucursales: SucursalConCajas[] }>('GET', '/sucursales'),
  });
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(esquemaRegistro),
    defaultValues: { nombre: '', tipo: 'TABLET' as const, sucursal_id: '', caja_id: '' },
  });
  const tipo = useWatch({ control, name: 'tipo' });
  const sucursalElegida = Number(useWatch({ control, name: 'sucursal_id' }));
  const cajas =
    sucursales.data?.sucursales
      .find((s) => s.id === sucursalElegida)
      ?.cajas.filter((c) => c.activa) ?? [];

  const enviar = handleSubmit(async (datos) => {
    setError(null);
    try {
      await api<{ equipo: Equipo }>('POST', '/equipos', {
        cuerpo: {
          nombre: datos.nombre,
          tipo: datos.tipo,
          sucursal_id: datos.sucursal_id,
          ...(datos.tipo === 'CAJA' ? { caja_id: Number(datos.caja_id) } : {}),
        },
      });
      alRegistrar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  });

  return (
    <form onSubmit={(evento) => void enviar(evento)} noValidate className="flex flex-col gap-4">
      <Campo
        etiqueta="Nombre del equipo"
        placeholder="Tablet Las Américas"
        error={errors.nombre?.message}
        {...register('nombre')}
      />
      <Selector etiqueta="Qué es" {...register('tipo')}>
        <option value="TABLET">Tablet de la tienda</option>
        <option value="CAJA">Caja (ligada a una caja)</option>
        <option value="MOVIL">Celular del negocio</option>
      </Selector>
      <Selector
        etiqueta="Sucursal"
        error={errors.sucursal_id?.message}
        {...register('sucursal_id')}
      >
        <option value="">Elija…</option>
        {sucursales.data?.sucursales
          .filter((s) => s.activa)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
      </Selector>
      {tipo === 'CAJA' && (
        <Selector etiqueta="Caja" error={errors.caja_id?.message} {...register('caja_id')}>
          <option value="">Elija…</option>
          {cajas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Selector>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton type="submit" ocupado={isSubmitting}>
        Registrar este equipo
      </Boton>
    </form>
  );
}

/** ¿Está abierta como aplicación instalada? Y, donde el navegador lo permite, el botón para instalarla. */
function Instalacion() {
  const instalada =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  const [oferta, setOferta] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const guardar = (evento: BeforeInstallPromptEvent) => {
      evento.preventDefault();
      setOferta(evento);
    };
    window.addEventListener('beforeinstallprompt', guardar);
    return () => window.removeEventListener('beforeinstallprompt', guardar);
  }, []);

  if (instalada) return <Aviso tipo="exito">La aplicación está instalada en este equipo.</Aviso>;
  return (
    <>
      <p className="text-texto-secundario">
        Instalada se abre a pantalla completa, como cualquier aplicación. En la tablet (Chrome):
        menú ⋮ → «Instalar aplicación». En iPhone (Safari): Compartir → «Agregar a inicio».
      </p>
      {oferta && (
        <Boton
          variante="secundario"
          onClick={() => void oferta.prompt().then(() => setOferta(null))}
        >
          <Download className="size-5" aria-hidden /> Instalar la aplicación
        </Boton>
      )}
    </>
  );
}

function PruebaDeCamara() {
  const [abierta, setAbierta] = useState(false);
  const [leido, setLeido] = useState<string | null>(null);
  return (
    <>
      <p className="text-texto-secundario">
        Apunte la cámara a cualquier código QR (por ejemplo, el de un ticket). Si aparece su texto
        abajo, este equipo puede escanear.
      </p>
      {abierta && <EscanerCamara alLeer={setLeido} />}
      {leido && (
        <Aviso tipo="exito">
          Código leído: <span className="font-mono break-all">{leido}</span>
        </Aviso>
      )}
      <Boton variante="secundario" onClick={() => setAbierta(!abierta)}>
        {abierta ? 'Cerrar la cámara' : 'Probar la cámara'}
      </Boton>
    </>
  );
}

function PruebaDeImpresora({ equipo }: { equipo: string }) {
  const [nombre, setNombre] = useState<string | null>(null);
  const [gaveta, setGaveta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(
    null,
  );
  const porUsb = modoDeImpresion() === 'usb';

  useEffect(() => {
    // La que ya se autorizó antes en este equipo se reconecta sola
    if (!porUsb) return;
    void impresoraLista().then((lista) => setNombre(lista?.nombre ?? null));
  }, [porUsb]);

  if (!porUsb) {
    return (
      <Aviso tipo="info">
        <p className="font-semibold">Este equipo imprime por el diálogo de imprimir</p>
        <p className="font-normal">
          {navegadorImprimePorUsb()
            ? 'En una computadora la impresora la maneja su driver: los tickets salen por el diálogo de imprimir, o directo si Chrome se abre en modo quiosco (--kiosk-printing).'
            : 'Este navegador no imprime por USB. La impresión directa es del celular o la tablet Android del mostrador, con Chrome.'}{' '}
          Para probarlo, cierre un turno de caja e imprima su ticket.
        </p>
      </Aviso>
    );
  }

  const hacer = async (accion: () => Promise<string>) => {
    setOcupado(true);
    setResultado(null);
    try {
      setResultado({ tipo: 'exito', texto: await accion() });
    } catch (error) {
      setResultado({ tipo: 'error', texto: mensajeDeImpresora(error) });
    } finally {
      setOcupado(false);
    }
  };

  const conectar = () =>
    hacer(async () => {
      const elegida = await conectarImpresora();
      setNombre(elegida.nombre);
      return `Impresora conectada: ${elegida.nombre}.`;
    });

  const imprimir = () =>
    hacer(async () => {
      await imprimirPorUsb(
        paginaDePrueba({ equipo, fecha: formatoFechaHora(new Date().toISOString()), gaveta }),
      );
      return 'La página de prueba se envió a la impresora. Revise en el papel los acentos, el código QR y el corte.';
    });

  return (
    <>
      <p className="text-texto-secundario">
        {nombre
          ? `Conectada: ${nombre}.`
          : 'Conecte la impresora por USB y tóquela en la lista que muestra el navegador.'}
      </p>
      <label className="flex min-h-toque items-center gap-3">
        <input
          type="checkbox"
          className="size-6 accent-esmeralda"
          checked={gaveta}
          onChange={(evento) => setGaveta(evento.target.checked)}
        />
        Abrir también la gaveta de dinero
      </label>
      {resultado && <Aviso tipo={resultado.tipo}>{resultado.texto}</Aviso>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Boton variante="secundario" ocupado={ocupado} onClick={() => void conectar()}>
          {nombre ? 'Cambiar de impresora' : 'Conectar impresora'}
        </Boton>
        <Boton ocupado={ocupado} disabled={!nombre} onClick={() => void imprimir()}>
          Imprimir página de prueba
        </Boton>
      </div>
    </>
  );
}

const DESPIERTA = {
  inactivo: {
    tipo: 'info',
    texto:
      'No hace falta aquí: la pantalla se mantiene encendida solo en un equipo registrado, mientras está abierto.',
  },
  activo: {
    tipo: 'exito',
    texto: 'La pantalla se mantiene encendida mientras el equipo esté abierto.',
  },
  'no-disponible': {
    tipo: 'aviso',
    texto:
      'Este navegador no puede mantener la pantalla encendida. Use Chrome y desactive el apagado automático de la pantalla en los ajustes del equipo.',
  },
  perdido: {
    tipo: 'aviso',
    texto:
      'El equipo dejó de mantener la pantalla encendida (suele ser el ahorro de batería). Toque «Mantener encendida» en el aviso de arriba.',
  },
} as const;

/** ¿La pantalla se queda encendida? De eso dependen la cola de tickets y la impresión automática. */
function PantallaEncendida() {
  const estado = DESPIERTA[useDespierta()];
  return <Aviso tipo={estado.tipo}>{estado.texto}</Aviso>;
}

/** Lo que hay que saber de este equipo: si está registrado, la app, la cámara y la impresora. */
export function EsteEquipo() {
  const sesion = useSesionActiva();
  const { bloquear } = useSesion();
  const { equipo, acceso } = sesion;
  const [registrado, setRegistrado] = useState(false);
  const puedeRegistrar = tienePermiso(sesion, ['SUCURSALES_GESTIONAR']);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Este equipo</h1>
        <p className="text-texto-secundario">Para dejarlo listo y comprobar que todo funciona.</p>
      </header>

      <Seccion icono={<TabletSmartphone className="size-6" aria-hidden />} titulo="Registro">
        {equipo ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{equipo.nombre}</span>
            <Etiqueta tono="exito">Equipo registrado</Etiqueta>
            <Etiqueta>
              {TIPOS_DE_EQUIPO[equipo.tipo as keyof typeof TIPOS_DE_EQUIPO] ?? equipo.tipo}
            </Etiqueta>
            <Etiqueta>{equipo.sucursal.nombre}</Etiqueta>
          </div>
        ) : registrado ? (
          <>
            <Aviso tipo="exito">
              Equipo registrado. Cierre su sesión: desde ahora, quienes trabajan en esa sucursal ya
              pueden entrar aquí con todo lo de su rol.
            </Aviso>
            <Boton onClick={() => void bloquear()}>Cerrar sesión</Boton>
          </>
        ) : (
          <>
            <p className="text-texto-secundario">
              Este navegador no es un equipo registrado.{' '}
              {acceso === 'CELULAR'
                ? 'Por eso tiene el acceso del celular: lo de caja se hace en la tablet de la sucursal.'
                : 'Las encargadas y vendedoras solo tienen todo lo de su rol en un equipo registrado.'}
            </p>
            {puedeRegistrar && <RegistrarEquipo alRegistrar={() => setRegistrado(true)} />}
          </>
        )}
      </Seccion>

      <Seccion icono={<Download className="size-6" aria-hidden />} titulo="Aplicación">
        <Instalacion />
      </Seccion>

      <Seccion icono={<Sun className="size-6" aria-hidden />} titulo="Pantalla encendida">
        <PantallaEncendida />
      </Seccion>

      <Seccion icono={<Camera className="size-6" aria-hidden />} titulo="Cámara">
        <PruebaDeCamara />
      </Seccion>

      <Seccion icono={<Printer className="size-6" aria-hidden />} titulo="Impresora de tickets">
        <PruebaDeImpresora equipo={equipo?.nombre ?? 'Sin registrar'} />
      </Seccion>
    </div>
  );
}
