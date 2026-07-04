import { Module } from "@nestjs/common";
import { AppConfig } from "./config/app-config.js";
import { RepositoryProvider } from "./data/repositories.js";
import { DebugController } from "./controllers/debug.controller.js";
import { HomeController } from "./controllers/home.controller.js";
import { JwkController } from "./controllers/jwk.controller.js";
import { LtiController } from "./controllers/lti.controller.js";
import { OAuthController } from "./controllers/oauth.controller.js";
import { QuizController } from "./controllers/quiz.controller.js";
import { SebController } from "./controllers/seb.controller.js";
import { StaticJsController } from "./controllers/static-js.controller.js";
import { CanvasApiService } from "./services/canvas-api.service.js";
import { ContentService } from "./services/content.service.js";
import { DeepLinkModuleService } from "./services/deep-link-module.service.js";
import { JwkService } from "./services/jwk.service.js";
import { LtiService } from "./services/lti.service.js";
import { LtiStateService } from "./services/lti-state.service.js";
import { QuizService } from "./services/quiz.service.js";
import { SebAccessProofService } from "./services/seb-access-proof.service.js";
import { SebConfigKeyService } from "./services/seb-config-key.service.js";
import { SebConfigurationService } from "./services/seb-configuration.service.js";
import { SebDetector } from "./services/seb-detector.service.js";

@Module({
  controllers: [
    DebugController,
    HomeController,
    JwkController,
    LtiController,
    OAuthController,
    QuizController,
    SebController,
    StaticJsController
  ],
  providers: [
    AppConfig,
    RepositoryProvider,
    CanvasApiService,
    ContentService,
    DeepLinkModuleService,
    JwkService,
    LtiService,
    LtiStateService,
    QuizService,
    SebAccessProofService,
    SebConfigKeyService,
    SebConfigurationService,
    SebDetector
  ]
})
export class AppModule {}
