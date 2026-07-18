import { Module } from "@nestjs/common";
import { AppConfig } from "./config/app-config.js";
import { RepositoryProvider } from "./data/repositories.js";
import { PostgresDatabase } from "./data/postgres-client.js";
import { DebugController } from "./controllers/debug.controller.js";
import { AdminController } from "./controllers/admin.controller.js";
import { HomeController } from "./controllers/home.controller.js";
import { JwkController } from "./controllers/jwk.controller.js";
import { LtiController } from "./controllers/lti.controller.js";
import { OAuthController } from "./controllers/oauth.controller.js";
import { QuizController } from "./controllers/quiz.controller.js";
import { SebController } from "./controllers/seb.controller.js";
import { StaticJsController } from "./controllers/static-js.controller.js";
import { AssessmentService } from "./services/assessment.service.js";
import { AdminAuthorizationService } from "./services/admin-authorization.service.js";
import { AssessmentAuthorizationService } from "./services/assessment-authorization.service.js";
import { CanvasApiService } from "./services/canvas-api.service.js";
import { CourseSettingsService } from "./services/course-settings.service.js";
import { DetectorTraceService } from "./services/detector-trace.service.js";
import { JwkService } from "./services/jwk.service.js";
import { LtiService } from "./services/lti.service.js";
import { LtiStateService } from "./services/lti-state.service.js";
import { SebAccessProofService } from "./services/seb-access-proof.service.js";
import { SebConfigKeyService } from "./services/seb-config-key.service.js";
import { SebConfigurationService } from "./services/seb-configuration.service.js";
import { SebDetector } from "./services/seb-detector.service.js";
import { SebConfigGrantService } from "./services/seb-config-grant.service.js";
import { SebSessionHandoffService } from "./services/seb-session-handoff.service.js";
import { DistributedAdmissionService } from "./security/distributed-admission.js";

@Module({
  controllers: [
    AdminController,
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
    PostgresDatabase,
    RepositoryProvider,
    AssessmentService,
    AdminAuthorizationService,
    AssessmentAuthorizationService,
    CanvasApiService,
    CourseSettingsService,
    DetectorTraceService,
    JwkService,
    LtiService,
    LtiStateService,
    SebAccessProofService,
    SebConfigGrantService,
    SebSessionHandoffService,
    SebConfigKeyService,
    SebConfigurationService,
    SebDetector,
    DistributedAdmissionService
  ]
})
export class AppModule {}
