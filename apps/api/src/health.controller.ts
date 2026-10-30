import { Controller, Get } from "@nestjs/common";
import { one } from "@cupons/db";

@Controller("health")
export class HealthController {
  @Get()
  async health() {
    const db = await one<{ ok: number }>("SELECT 1 AS ok");
    return { ok: db?.ok === 1, time: new Date().toISOString() };
  }
}
