import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  controllers: [VentasController],
  providers: [VentasService],
})
export class VentasModule {}
