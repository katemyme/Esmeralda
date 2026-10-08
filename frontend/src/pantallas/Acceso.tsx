import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { ErrorApi, mensajeDeError } from '../api/cliente';
import type { PantallaPin } from '../api/tipos';
import { useSesion } from '../sesion/sesion';
import { Aviso, Boton, Campo, EspacioLogo, Etiqueta, Marca } from '../ui/basicos';
import { TecladoPin } from '../ui/TecladoPin';

const esquemaLogin = z.object({
  username: z.string().trim().min(1, 'Escriba su usuario'),
  password: z.string().min(1, 'Escriba su contraseña'),
});
type DatosLogin = z.infer<typeof esquemaLogin>;

function ConPassword({ equipoCerrado }: { equipoCerrado: boolean }) {
  const { entrar } = useSesion();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DatosLogin>({ resolver: zodResolver(esquemaLogin) });

  const enviar = handleSubmit(async ({ username, password }) => {
    setError(null);
    try {
      await entrar(username, password);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  });

  return (
    <form onSubmit={(evento) => void enviar(evento)} className="flex flex-col gap-4" noValidate>
      {equipoCerrado && (
        <Aviso tipo="info">
          Este equipo está cerrado. La primera persona del día entra con su usuario y contraseña;
          después, las demás entran con su PIN.
        </Aviso>
      )}
      <Campo
        etiqueta="Usuario"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        error={errors.username?.message}
        {...register('username')}
      />
      <Campo
        etiqueta="Contraseña"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton type="submit" ancho ocupado={isSubmitting}>
        Entrar
      </Boton>
    </form>
  );
}

function ConPin({ usuarios }: { usuarios: PantallaPin['usuarios'] }) {
  const { entrarConPin } = useSesion();
  const [elegida, setElegida] = useState<PantallaPin['usuarios'][number] | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [bloqueadas, setBloqueadas] = useState<number[]>([]);

  const estaBloqueada = (u: PantallaPin['usuarios'][number]) =>
    u.pin_bloqueado || bloqueadas.includes(u.id);

  const probar = async (completo: string) => {
    if (!elegida) return;
    setOcupado(true);
    setError(null);
    try {
      await entrarConPin(elegida.id, completo);
    } catch (causa) {
      setPin('');
      setError(mensajeDeError(causa));
      if (causa instanceof ErrorApi && causa.codigo === 'PIN_BLOQUEADO') {
        setBloqueadas((lista) => [...lista, elegida.id]);
      }
    } finally {
      setOcupado(false);
    }
  };

  if (!elegida) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-center text-lg font-semibold">¿Quién va a usar el equipo?</h2>
        <ul className="grid grid-cols-2 gap-3">
          {usuarios.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => {
                  setElegida(u);
                  setPin('');
                  setError(null);
                }}
                className="flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-2xl border border-borde bg-superficie px-3 py-3 text-center font-semibold active:bg-esmeralda-claro"
              >
                {u.nombre_completo}
                {estaBloqueada(u) && <Etiqueta tono="error">PIN bloqueado</Etiqueta>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setElegida(null)}
        className="flex min-h-toque items-center gap-2 self-start rounded-xl px-2 font-medium text-esmeralda"
      >
        <ArrowLeft className="size-5" aria-hidden /> Otra persona
      </button>
      <h2 className="text-center text-lg font-semibold">{elegida.nombre_completo}</h2>
      {estaBloqueada(elegida) ? (
        <Aviso tipo="error">
          Su PIN está bloqueado por intentos fallidos. Entre con su usuario y contraseña y cree uno
          nuevo.
        </Aviso>
      ) : (
        <>
          <p className="text-center text-texto-secundario">Escriba su PIN de 4 dígitos</p>
          <TecladoPin
            nombre={`PIN de ${elegida.nombre_completo}`}
            valor={pin}
            alCambiar={setPin}
            alCompletar={(completo) => void probar(completo)}
            deshabilitado={ocupado}
          />
          {error && <Aviso tipo="error">{error}</Aviso>}
        </>
      )}
    </div>
  );
}

/** Lo que se ve sin sesión: el inicio con contraseña o, en un equipo abierto, la pantalla de PIN. */
export function Acceso({ pantalla }: { pantalla: PantallaPin }) {
  const hayPin = pantalla.equipo !== null && pantalla.abierto && pantalla.usuarios.length > 0;
  const [modo, setModo] = useState<'pin' | 'password'>(hayPin ? 'pin' : 'password');
  const { equipo } = pantalla;
  // Quien entre después empieza en el inicio, no en la pantalla donde quedó la persona anterior
  const navegar = useNavigate();
  useEffect(() => {
    void navegar('/', { replace: true });
  }, [navegar]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-esmeralda-oscuro px-4 py-8">
      <header className="flex flex-col items-center gap-3 text-2xl text-white">
        <EspacioLogo className="size-16" />
        <h1>
          <Marca sobreOscuro />
        </h1>
      </header>
      <div className="w-full max-w-md rounded-3xl bg-superficie p-6 shadow-xl">
        {equipo && (
          <p className="mb-4 flex items-center justify-center gap-2 text-sm text-texto-secundario">
            <Lock className="size-4" aria-hidden />
            {equipo.nombre} · {equipo.sucursal.nombre}
          </p>
        )}
        {modo === 'pin' ? (
          <ConPin usuarios={pantalla.usuarios} />
        ) : (
          <ConPassword equipoCerrado={equipo !== null && !pantalla.abierto} />
        )}
        {hayPin && (
          <Boton
            variante="texto"
            ancho
            className="mt-4"
            onClick={() => setModo(modo === 'pin' ? 'password' : 'pin')}
          >
            {modo === 'pin' ? 'Entrar con usuario y contraseña' : 'Entrar con mi PIN'}
          </Boton>
        )}
      </div>
    </main>
  );
}
