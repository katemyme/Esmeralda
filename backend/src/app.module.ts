import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AlertasModule } from './alertas/alertas.module';
import { AutenticacionModule } from './autenticacion/autenticacion.module';
import { BaseDatosModule } from './base-datos/base-datos.module';
import { FiltroErrores } from './comun/filtro-errores';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { EquiposModule } from './equipos/equipos.module';
import { ParametrosModule } from './parametros/parametros.module';
import { RolesModule } from './roles/roles.module';
import { SaludController } from './salud/salud.controller';
import { SucursalesModule } from './sucursales/sucursales.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ConfiguracionModule,
    BaseDatosModule,
    AutenticacionModule,
    EquiposModule,
    UsuariosModule,
    RolesModule,
    ParametrosModule,
    AlertasModule,
    SucursalesModule,
  ],
  controllers: [SaludController],
  providers: [{ provide: APP_FILTER, useClass: FiltroErrores }],
})
export class AppModule {}
