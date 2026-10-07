import { Module } from '@nestjs/common';
import { TipoCambioController } from './tipo-cambio.controller';
import { TipoCambioService } from './tipo-cambio.service';

@Module({
  controllers: [TipoCambioController],
  providers: [TipoCambioService],
})
export class TipoCambioModule {}
