# M03 NestJS dynamic module
Create ONLY apps/server/src/api/app.module.ts once; no Git, other edits, .env/data/harness/network. Read ONLY api/rounds.controller.ts export/constructor and application/runtime.ts type/token. Supplied context is sufficient.
Import Module and type DynamicModule from @nestjs/common; RoundsController './rounds.controller.ts'; RUNTIME_TOKEN and type Runtime '../application/runtime.ts'. Export @Module({}) class AppModule with static register(runtime:Runtime):DynamicModule returning {module:AppModule,controllers:[RoundsController],providers:[{provide:RUNTIME_TOKEN,useValue:runtime}]}. No env/HTTP/provider configuration/extra modules, global CLI or scopes. <=35lines, one successful write then npm run typecheck and stop.

