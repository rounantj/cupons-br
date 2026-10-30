import { CanActivate, ExecutionContext, HttpException, Injectable } from "@nestjs/common";

/** Limite simples por IP (memória do processo): suficiente para uma instância. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private hits = new Map<string, number[]>();
  private readonly limit = Number(process.env.RATE_LIMIT_PER_MIN ?? 30);

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const ip: string = req.ip ?? "?";
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.limit) throw new HttpException("muitas buscas, tente em instantes", 429);
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}
