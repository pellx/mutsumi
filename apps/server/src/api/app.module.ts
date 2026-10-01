/** M03 - root NestJS module; wires the injected runtime into RoundsController. */
import { Module, type DynamicModule } from '@nestjs/common';
import { RoundsController } from './rounds.controller.ts';
import { RUNTIME_TOKEN, type Runtime } from '../application/runtime.ts';

@Module({})
export class AppModule {
  static register(runtime: Runtime): DynamicModule {
    return {
      module: AppModule,
      controllers: [RoundsController],
      providers: [{ provide: RUNTIME_TOKEN, useValue: runtime }],
    };
  }
}