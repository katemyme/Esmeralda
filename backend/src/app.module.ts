import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AlertasModule } from './alertas/alertas.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AutenticacionModule } from './autenticacion/autenticacion.module';
import { BaseDatosModule } from './base-datos/base-datos.module';
import { CajaModule } from './caja/caja.module';
import { CargaInicialModule } from './carga-inicial/carga-inicial.module';
import { CategoriasModule } from './categorias/categorias.module';
import { FiltroErrores } from './comun/filtro-errores';
import { ComprasModule } from './compras/compras.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { ConteosModule } from './conteos/conteos.module';
import { EnviosModule } from './envios/envios.module';
import { EquiposModule } from './equipos/equipos.module';
import { FotosModule } from './fotos/fotos.module';
import { GamasModule } from './gamas/gamas.module';
import { InventarioModule } from './inventario/inventario.module';
import { MermasModule } from './mermas/mermas.module';
import { ParametrosModule } from './parametros/parametros.module';
import { PerforacionesModule } from './perforaciones/perforaciones.module';
import { ProductosModule } from './productos/productos.module';
import { PromocionesModule } from './promociones/promociones.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { ReportesModule } from './reportes/reportes.module';
import { RolesModule } from './roles/roles.module';
import { SaludController } from './salud/salud.controller';
import { SucursalesModule } from './sucursales/sucursales.module';
import { TipoCambioModule } from './tipo-cambio/tipo-cambio.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { VentasModule } from './ventas/ventas.module';

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
    // B5: inventario
    ProveedoresModule,
    ComprasModule,
    EnviosModule,
    MermasModule,
    ConteosModule,
    InventarioModule,
    CargaInicialModule,
    // B6: POS y caja
    TipoCambioModule,
    CajaModule,
    VentasModule,
    // B7: reportes
    ReportesModule,
  ],
  controllers: [SaludController],
  providers: [{ provide: APP_FILTER, useClass: FiltroErrores }],
})
export class AppModule {}
