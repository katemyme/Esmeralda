import { Global, Module } from '@nestjs/common';
import { CONFIGURACION, cargarConfiguracion } from './configuracion';

@Global()
@Module({
  providers: [{ provide: CONFIGURACION, useFactory: () => cargarConfiguracion() }],
  exports: [CONFIGURACION],
})
export class ConfiguracionModule {}
