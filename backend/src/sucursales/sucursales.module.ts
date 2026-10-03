import { Module } from '@nestjs/common';
import { CajasController, SucursalesController } from './sucursales.controller';
import { SucursalesService } from './sucursales.service';

@Module({
  controllers: [SucursalesController, CajasController],
  providers: [SucursalesService],
})
export class SucursalesModule {}
