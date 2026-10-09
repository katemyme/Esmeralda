import { Module } from '@nestjs/common';
import { AutenticacionModule } from '../autenticacion/autenticacion.module';
import { VentasModule } from '../ventas/ventas.module';
import { ColaImpresionController } from './cola-impresion.controller';
import { ColaImpresionService } from './cola-impresion.service';

@Module({
  imports: [AutenticacionModule, VentasModule],
  controllers: [ColaImpresionController],
  providers: [ColaImpresionService],
})
export class ColaImpresionModule {}
