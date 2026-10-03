import { Module } from '@nestjs/common';
import { EnviosController } from './envios.controller';
import { EnviosService } from './envios.service';

@Module({
  controllers: [EnviosController],
  providers: [EnviosService],
})
export class EnviosModule {}
