import { Controller, Get } from "@nestjs/common";
import { JwkService } from "../services/jwk.service.js";

@Controller()
export class JwkController {
  constructor(private readonly jwkService: JwkService) {}

  @Get("/.well-known/jwks.json")
  getJwks(): Promise<{ keys: unknown[] }> {
    return this.jwkService.getPublicJwks();
  }
}
