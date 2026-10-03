import { Module } from '@nestjs/common';
import { CargaInicialController } from './carga-inicial.controller';
import { CargaInicialService } from './carga-inicial.service';

@Module({
  controllers: [CargaInicialController],
  providers: [CargaInicialService],
})
export class CargaInicialModule {}
