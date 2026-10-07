import { Module } from '@nestjs/common';
import { CajaController, DatosCajaController, TurnosController } from './caja.controller';
import { CajaService } from './caja.service';

@Module({
  controllers: [CajaController, TurnosController, DatosCajaController],
  providers: [CajaService],
})
export class CajaModule {}
