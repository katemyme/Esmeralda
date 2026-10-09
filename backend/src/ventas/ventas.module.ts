import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  controllers: [VentasController],
  providers: [VentasService],
  exports: [VentasService], // la cola de impresión arma con él el ticket de la venta
})
export class VentasModule {}
