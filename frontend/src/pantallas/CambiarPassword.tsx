import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { mensajeDeError } from '../api/cliente';
import { useSesion, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Marca } from '../ui/basicos';

// La misma política del backend: mínimo 8, con letras y números
const esquema = z
  .object({
    actual: z.string().min(1, 'Escriba la contraseña que le dieron'),
    nueva: z
      .string()
      .min(8, 'Debe tener al menos 8 caracteres')
      .regex(/\p{L}/u, 'Debe incluir al menos una letra')
      .regex(/\d/, 'Debe incluir al menos un número'),
    repetida: z.string(),
  })
  .refine((datos) => datos.nueva === datos.repetida, {
    path: ['repetida'],
    message: 'Las dos contraseñas nuevas no son iguales',
  });
type Datos = z.infer<typeof esquema>;

/** Con una contraseña temporal no se pasa de aquí: primero hay que poner una propia. */
export function CambiarPassword() {
  const { cambiarPassword, bloquear } = useSesion();
  const { usuario } = useSesionActiva();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Datos>({ resolver: zodResolver(esquema) });

  const enviar = handleSubmit(async ({ actual, nueva }) => {
    setError(null);
    try {
      await cambiarPassword(actual, nueva);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  });

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-esmeralda-oscuro px-4 py-8">
      <h1 className="text-2xl text-white">
        <Marca sobreOscuro />
      </h1>
      <form
        onSubmit={(evento) => void enviar(evento)}
        noValidate
        className="flex w-full max-w-md flex-col gap-4 rounded-3xl bg-superficie p-6 shadow-xl"
      >
        <div>
          <h2 className="text-lg font-semibold">Cree su contraseña</h2>
          <p className="mt-1 text-texto-secundario">
            {usuario.nombre_completo}, la contraseña que le dieron es temporal. Ponga una que solo
            usted conozca: mínimo 8 caracteres, con letras y números.
          </p>
        </div>
        <Campo
          etiqueta="Contraseña temporal"
          type="password"
          autoComplete="current-password"
          error={errors.actual?.message}
          {...register('actual')}
        />
        <Campo
          etiqueta="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          error={errors.nueva?.message}
          {...register('nueva')}
        />
        <Campo
          etiqueta="Repita la contraseña nueva"
          type="password"
          autoComplete="new-password"
          error={errors.repetida?.message}
          {...register('repetida')}
        />
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Boton type="submit" ancho ocupado={isSubmitting}>
          Guardar y continuar
        </Boton>
        <Boton variante="texto" ancho onClick={() => void bloquear()}>
          Cerrar sesión
        </Boton>
      </form>
    </main>
  );
}
