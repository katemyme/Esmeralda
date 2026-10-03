import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AlertasModule } from './alertas/alertas.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AutenticacionModule } from './autenticacion/autenticacion.module';
import { BaseDatosModule } from './base-datos/base-datos.module';
import { CategoriasModule } from './categorias/categorias.module';
import { FiltroErrores } from './comun/filtro-errores';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { EquiposModule } from './equipos/equipos.module';
import { FotosModule } from './fotos/fotos.module';
import { GamasModule } from './gamas/gamas.module';
import { ParametrosModule } from './parametros/parametros.module';
import { PerforacionesModule } from './perforaciones/perforaciones.module';
import { ProductosModule } from './productos/productos.module';
import { PromocionesModule } from './promociones/promociones.module';
import { RolesModule } from './roles/roles.module';
import { SaludController } from './salud/salud.controller';
import { SucursalesModule } from './sucursales/sucursales.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ConfiguracionModule,
    BaseDatosModule,
    AutenticacionModule,
    // B3: panel de administración
    EquiposModule,
    UsuariosModule,
    RolesModule,
    ParametrosModule,
    AlertasModule,
    SucursalesModule,
    AuditoriaModule,
    // B4: catálogo
    FotosModule,
    CategoriasModule,
    GamasModule,
    ProductosModule,
    PerforacionesModule,
    PromocionesModule,
  ],
  controllers: [SaludController],
  providers: [{ provide: APP_FILTER, useClass: FiltroErrores }],
})
export class AppModule {}
