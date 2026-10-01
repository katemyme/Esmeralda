import { Global, Module } from '@nestjs/common';
import { BaseDatosService } from './base-datos.service';

@Global()
@Module({
  providers: [BaseDatosService],
  exports: [BaseDatosService],
})
export class BaseDatosModule {}
