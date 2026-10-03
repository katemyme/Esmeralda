import { Module } from '@nestjs/common';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';

@Module({
  controllers: [InventarioController],
  providers: [InventarioService],
})
export class InventarioModule {}
