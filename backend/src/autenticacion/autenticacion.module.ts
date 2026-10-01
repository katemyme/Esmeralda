import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { CONFIGURACION, type Configuracion } from '../configuracion/configuracion';
import { AutenticacionController } from './autenticacion.controller';
import { AutenticacionService } from './autenticacion.service';
import { CookiesAutenticacion } from './cookies';
import { GuardiaAutenticacion } from './guardia-autenticacion';
import { DURACION_TOKEN_ACCESO_SEG } from './usuario-autenticado';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIGURACION],
      useFactory: (config: Configuracion) => ({
        secret: config.autenticacion.secretoJwt,
        signOptions: { algorithm: 'HS256', expiresIn: DURACION_TOKEN_ACCESO_SEG },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    // Límite por IP para login y cambio de contraseña (además del bloqueo por usuario en la base)
    ThrottlerModule.forRootAsync({
      inject: [CONFIGURACION],
      useFactory: (config: Configuracion) => ({
        throttlers: [{ ttl: 60_000, limit: config.autenticacion.limiteLoginPorMinuto }],
        errorMessage:
          'Demasiados intentos desde este equipo. Espere un minuto y vuelva a intentarlo.',
      }),
    }),
  ],
  controllers: [AutenticacionController],
  providers: [
    AutenticacionService,
    CookiesAutenticacion,
    { provide: APP_GUARD, useClass: GuardiaAutenticacion },
  ],
  exports: [CookiesAutenticacion],
})
export class AutenticacionModule {}
