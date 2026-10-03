import { Module } from '@nestjs/common';
import { PromocionesController } from './promociones.controller';
import { PromocionesService } from './promociones.service';

@Module({
  controllers: [PromocionesController],
  providers: [PromocionesService],
})
export class PromocionesModule {}
