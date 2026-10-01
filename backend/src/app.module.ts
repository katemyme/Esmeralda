import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AutenticacionModule } from './autenticacion/autenticacion.module';
import { BaseDatosModule } from './base-datos/base-datos.module';
import { FiltroErrores } from './comun/filtro-errores';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { EquiposModule } from './equipos/equipos.module';
import { SaludController } from './salud/salud.controller';

@Module({
  imports: [ConfiguracionModule, BaseDatosModule, AutenticacionModule, EquiposModule],
  controllers: [SaludController],
  providers: [{ provide: APP_FILTER, useClass: FiltroErrores }],
})
export class AppModule {}
