import { Module } from '@nestjs/common';
import { PerforacionesController } from './perforaciones.controller';
import { PerforacionesService } from './perforaciones.service';

@Module({
  controllers: [PerforacionesController],
  providers: [PerforacionesService],
})
export class PerforacionesModule {}
