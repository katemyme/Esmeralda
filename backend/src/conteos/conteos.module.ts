import { Module } from '@nestjs/common';
import { ConteosController } from './conteos.controller';
import { ConteosService } from './conteos.service';

@Module({
  controllers: [ConteosController],
  providers: [ConteosService],
})
export class ConteosModule {}
