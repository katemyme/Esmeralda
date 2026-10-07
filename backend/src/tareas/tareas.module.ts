import { Module } from '@nestjs/common';
import { TareasService } from './tareas.service';

@Module({
  providers: [TareasService],
})
export class TareasModule {}
