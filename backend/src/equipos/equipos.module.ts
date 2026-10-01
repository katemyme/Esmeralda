import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module';
import { EquiposController } from './equipos.controller';
import { EquiposService } from './equipos.service';

@Module({
  imports: [AutenticacionModule],
  controllers: [EquiposController],
  providers: [EquiposService],
})
export class EquiposModule {}
