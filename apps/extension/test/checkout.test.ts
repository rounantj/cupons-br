import { describe, expect, it } from "vitest";
import { classify } from "../src/content/checkout";

const ml = (type: string, text: string, code = "") =>
  ({ responseMessage: { type, text }, tracking: { event: { eventData: { response_type: type, response_code: code } } } });

describe("resposta do campo de cupom do checkout do ML", () => {
  it("classifica pelas mensagens reais", () => {
    expect(classify(200, ml("error", "Confira se o cupom está correto", "INVALID_1")).result).toBe("invalid");
    expect(classify(200, ml("error", 'Seu cupom foi salvo em "Cupons", pois não se aplica a esta compra.')).result).toBe("not_applicable");
    expect(classify(200, ml("error", "O cupom não está mais disponível.")).result).toBe("expired");
    expect(classify(200, ml("success", "Cupom aplicado")).result).toBe("works");
    expect(classify(500, null).result).toBe("unknown");
  });
  it("guarda o código e o texto da loja", () => {
    expect(classify(200, ml("error", "Confira se o cupom está correto", "INVALID_1")).message).toBe("INVALID_1: Confira se o cupom está correto");
  });
});
