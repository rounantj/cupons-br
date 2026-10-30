import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { SearchesController } from "./searches.controller";
import { SearchesService } from "./searches.service";

@Module({ controllers: [SearchesController, HealthController], providers: [SearchesService] })
export class AppModule {}
