import { Module } from "@nestjs/common";
import { CouponTestsController } from "./coupon-tests.controller";
import { HealthController } from "./health.controller";
import { NewsController } from "./news.controller";
import { NewsService } from "./news.service";
import { SearchesController } from "./searches.controller";
import { SearchesService } from "./searches.service";

@Module({ controllers: [SearchesController, CouponTestsController, NewsController, HealthController], providers: [SearchesService, NewsService] })
export class AppModule {}
