import { Module } from "@nestjs/common";
import { CouponTestsController } from "./coupon-tests.controller";
import { HealthController } from "./health.controller";
import { SearchesController } from "./searches.controller";
import { SearchesService } from "./searches.service";

@Module({ controllers: [SearchesController, CouponTestsController, HealthController], providers: [SearchesService] })
export class AppModule {}
