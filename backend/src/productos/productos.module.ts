import { Module } from '@nestjs/common';
import { FotosModule } from '../fotos/fotos.module';
import { ProductosController, VariantesController } from './productos.controller';
import { ProductosService } from './productos.service';

@Module({
  imports: [FotosModule],
  controllers: [ProductosController, VariantesController],
  providers: [ProductosService],
})
export class ProductosModule {}
