import { Module } from '@nestjs/common';
import { MermasController } from './mermas.controller';
import { MermasService } from './mermas.service';

@Module({
  controllers: [MermasController],
  providers: [MermasService],
})
export class MermasModule {}
