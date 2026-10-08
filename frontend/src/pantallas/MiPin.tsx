import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, mensajeDeError } from '../api/cliente';
import { useSesion, useSesionActiva } from '../sesion/sesion';
import { Aviso, Boton, Campo, Tarjeta } from '../ui/basicos';

const ESCALERAS = '0123456789876543210';

/** La misma regla del backend: 4 dígitos, sin el mismo dígito cuatro veces ni escaleras. */
export const esquemaPin = z
  .string()
  .regex(/^\d{4}$/, 'El PIN debe tener exactamente 4 dígitos')
  .refine(
    (pin) => !/^(\d)\1{3}$/.test(pin) && !ESCALERAS.includes(pin),
    'Ese PIN es muy fácil de adivinar: no use 0000, 1234 ni parecidos',
  );

const esquema = z
  .object({
    password: z.string().min(1, 'Escriba su contraseña'),
    pin: esquemaPin,
    repetido: z.string(),
  })
  .refine((datos) => datos.pin === datos.repetido, {
    path: ['repetido'],
    message: 'Los dos PIN no son iguales',
  });
type Datos = z.infer<typeof esquema>;

const ESTADOS = {
  SIN_PIN: 'Todavía no tiene PIN.',
  ACTIVO: 'Ya tiene un PIN. Si crea otro, el anterior deja de servir.',
  BLOQUEADO: 'Su PIN está bloqueado por intentos fallidos. Al crear uno nuevo se desbloquea.',
};

/** Crear o cambiar el PIN propio, confirmando con la contraseña. */
export function MiPin() {
  const { usuario } = useSesionActiva();
  const { refrescar } = useSesion();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Datos>({ resolver: zodResolver(esquema) });

  const enviar = handleSubmit(async ({ password, pin }) => {
    setError(null);
    setGuardado(false);
    try {
      await api<void>('PUT', '/auth/pin', { cuerpo: { password_actual: password, pin } });
      await refrescar();
      reset();
      setGuardado(true);
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  });

  if (usuario.rol.codigo === 'ADMIN') {
    return <Aviso tipo="info">El administrador no usa PIN: entra siempre con su contraseña.</Aviso>;
  }

  const campoPin = {
    type: 'password',
    inputMode: 'numeric',
    maxLength: 4,
    autoComplete: 'off',
    className: 'text-center text-2xl tracking-[0.5em]',
  } as const;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Mi PIN</h1>
        <p className="text-texto-secundario">
          Cuatro dígitos para entrar rápido en la tablet de su sucursal. Solo sirve ahí, y solo
          después de que alguien abrió el equipo con su contraseña.
        </p>
      </header>
      <Aviso tipo={usuario.pin === 'BLOQUEADO' ? 'aviso' : 'info'}>{ESTADOS[usuario.pin]}</Aviso>
      <Tarjeta>
        <form onSubmit={(evento) => void enviar(evento)} noValidate className="flex flex-col gap-4">
          <Campo
            etiqueta="Su contraseña"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <Campo
            etiqueta="PIN nuevo"
            error={errors.pin?.message}
            {...campoPin}
            {...register('pin')}
          />
          <Campo
            etiqueta="Repita el PIN"
            error={errors.repetido?.message}
            {...campoPin}
            {...register('repetido')}
          />
          {error && <Aviso tipo="error">{error}</Aviso>}
          {guardado && <Aviso tipo="exito">PIN guardado. Ya puede usarlo en la tablet.</Aviso>}
          <Boton type="submit" ancho ocupado={isSubmitting}>
            Guardar mi PIN
          </Boton>
        </form>
      </Tarjeta>
    </div>
  );
}
