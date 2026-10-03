import { Module } from '@nestjs/common';
import { GamasController } from './gamas.controller';
import { GamasService } from './gamas.service';

@Module({
  controllers: [GamasController],
  providers: [GamasService],
})
export class GamasModule {}
