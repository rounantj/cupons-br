import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { CreateSearch, CreateSearchSchema, SearchView } from "@cupons/contracts";
import { RateLimitGuard } from "./rate-limit.guard";
import { SearchesService } from "./searches.service";
import { ZodPipe } from "./zod.pipe";

@Controller("v1/searches")
export class SearchesController {
  constructor(private readonly searches: SearchesService) {}

  /** Enfileira (ou reaproveita) a busca. 202 = em andamento; 200 = resposta pronta do cache. */
  @Post()
  @HttpCode(202)
  @UseGuards(RateLimitGuard)
  create(@Body(new ZodPipe(CreateSearchSchema)) body: CreateSearch): Promise<SearchView> {
    return this.searches.create(body);
  }

  /** Acompanha a busca até status "done" (ou "failed"). */
  @Get(":id")
  async get(@Param("id", new ParseUUIDPipe()) id: string): Promise<SearchView> {
    const view = await this.searches.view(id);
    if (!view) throw new NotFoundException("busca não encontrada");
    return view;
  }
}
