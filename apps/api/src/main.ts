import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  // API pública sem cookies: a extensão chama de chrome-extension://... e via ngrok
  app.enableCors({ origin: true, allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning", "X-Client-Version"] });
  app.getHttpAdapter().getInstance().set("trust proxy", true);
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
  console.log(`API ouvindo em :${process.env.PORT ?? 3000}`);
}
bootstrap();
