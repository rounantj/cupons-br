import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { CouponTest, CouponTestSchema } from "@cupons/contracts";
import { query } from "@cupons/db";
import { RateLimitGuard } from "./rate-limit.guard";
import { ZodPipe } from "./zod.pipe";

/**
 * Resultado de cupom testado no checkout pela extensão (sessão do próprio usuário, no navegador dele).
 * "works" libera o cupom na notificação de quem abrir o mesmo produto; "expired"/"invalid" o tira de circulação.
 */
@Controller("v1/coupon-tests")
export class CouponTestsController {
  @Post()
  @HttpCode(204)
  @UseGuards(RateLimitGuard)
  async create(@Body(new ZodPipe(CouponTestSchema)) t: CouponTest): Promise<void> {
    const message = t.message?.replace(/\s+/g, " ").trim().slice(0, 300) ?? null;
    if (!t.productIds.length) {
      await query("INSERT INTO coupon_tests (platform, code, result, message) VALUES ($1, $2, $3, $4)", [t.platform, t.code, t.result, message]);
      return;
    }
    // só produtos que existem (a extensão manda os produtos buscados recentemente, que estão no carrinho)
    await query(
      `INSERT INTO coupon_tests (product_id, platform, code, result, message)
       SELECT id, $2, $3, $4, $5 FROM products WHERE id = ANY($1::uuid[])`,
      [t.productIds, t.platform, t.code, t.result, message]);
  }
}
