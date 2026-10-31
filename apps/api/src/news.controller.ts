import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { CreateNewsLookup, CreateNewsLookupSchema, NewsLookupView } from "@cupons/contracts";
import { NewsService } from "./news.service";
import { RateLimitGuard } from "./rate-limit.guard";
import { ZodPipe } from "./zod.pipe";

/** Segunda extensão: a mesma notícia em outros veículos + análise da cobertura. */
@Controller("v1/news/lookups")
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Post()
  @HttpCode(202)
  @UseGuards(RateLimitGuard)
  create(@Body(new ZodPipe(CreateNewsLookupSchema)) body: CreateNewsLookup): Promise<NewsLookupView> {
    return this.news.create(body);
  }

  @Get(":id")
  async get(@Param("id", new ParseUUIDPipe()) id: string): Promise<NewsLookupView> {
    const view = await this.news.view(id);
    if (!view) throw new NotFoundException("consulta não encontrada");
    return view;
  }
}
