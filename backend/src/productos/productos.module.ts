import { Module } from '@nestjs/common';
import { ProductosController, VariantesController } from './productos.controller';
import { ProductosService } from './productos.service';

@Module({
  controllers: [ProductosController, VariantesController],
  providers: [ProductosService],
})
export class ProductosModule {}
