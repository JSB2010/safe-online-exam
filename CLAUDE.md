Wit# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Canvas SEB Integration is a Spring Boot LTI 1.3 application that integrates Safe Exam Browser (SEB) with Canvas LMS. It allows instructors to enforce SEB usage for specific quizzes, providing a secure lockdown browser environment for assessments. The system generates SEB configuration files, manages quiz access codes, and detects SEB browser environments.

## Build and Run Commands

### Local Development
```bash
# Build the project
mvn clean install

# Run locally with dev profile
mvn spring-boot:run -Dspring.profiles.active=dev

# Run tests
mvn test

# Run a single test class
mvn test -Dtest=LtiControllerTest

# Run a specific test method
mvn test -Dtest=LtiControllerTest#testLoginEndpoint
```

### Docker
```bash
# Build Docker image (requires JAR to be built first)
mvn clean package -DskipTests
docker build -t canvas-seb .

# Run Docker container locally
docker run -p 8080:8080 -e SPRING_PROFILES_ACTIVE=dev canvas-seb
```

### Google Cloud Deployment
```bash
# Deploy to dev environment using Cloud Build
gcloud builds submit --config=cloudbuild-dev.yaml

# Deploy to production using Cloud Build
gcloud builds submit --config=cloudbuild-prod.yaml
```

## Technology Stack

- **Java 21** with Spring Boot 3.2.3
- **LTI 1.3** using Nimbus JOSE + JWT for OAuth/OIDC authentication
- **Google Cloud Firestore** for NoSQL data storage (quizzes, SEB settings, OAuth tokens)
- **Google Cloud Secret Manager** for secure credential storage
- **Thymeleaf** for server-side templating
- **Canvas API** with OAuth2 authentication for quiz management
- Deployed on **Google Cloud Run** (Gen2)

## Architecture

### Data Storage Strategy
The application uses **Google Cloud Firestore** as its primary datastore (NOT PostgreSQL/Cloud SQL as originally designed). Collections:
- `quizzes` - Quiz metadata and settings
- `sebSettings` - SEB configuration settings per quiz
- `sebConfigs` - Generated SEB configuration files
- OAuth tokens stored in Firestore via `FirestoreOAuthTokenRepository`

### Authentication Flow
1. **LTI Launch Flow**: Canvas initiates OIDC login → `/lti/login` → redirects to Canvas auth → `/lti/launch` validates JWT
2. **Canvas OAuth2 Flow**: For Canvas API access, separate OAuth2 flow initiated via `/api/authorize` → user consents → callback to `/api/oauth2callback` → token stored in Firestore
3. **Two Authentication Contexts**: LTI tokens (for launch context) + Canvas OAuth tokens (for API calls) must be managed separately

### Key Controllers
- `LtiController` - Handles LTI 1.3 OIDC login and launch flows
- `LtiDeepLinkingController` - Handles LTI Deep Linking for course placement
- `CanvasOAuthController` - Manages Canvas API OAuth2 authorization flow
- `QuizController` - Teacher interface for managing quiz SEB settings
- `StudentQuizController` - Student-facing quiz launch and SEB detection
- `SebExitController` / `SebRedirectController` - Handles SEB quit links and redirects
- `DebugController` - Debug endpoints for troubleshooting (when `DEBUG_MODE=true`)

### Core Services
- `CanvasApiService` - Primary service for Canvas API interactions using OAuth2 tokens
- `LtiService` / `LtiCanvasService` - LTI message validation and Canvas context extraction
- `SebConfigService` / `SebConfigurationService` - SEB file generation and management
- `QuizService` - Quiz CRUD operations and SEB setting persistence
- `ModuleItemService` / `ModuleItemUpdateService` - Canvas module manipulation for SEB links
- `SecretManagerService` - GCP Secret Manager integration with caching
- `HybridCanvasAuthService` - Coordinates between LTI and OAuth2 authentication

### SEB Implementation
- `SebConfigGenerator` - Generates .seb files in Apple plist XML format, GZIP compressed with "plnd" prefix
- `SebDetector` / `SebDetectorExtension` - Detects SEB browser via User-Agent and custom headers
- Access codes are set on Canvas quizzes and embedded in SEB configs to enforce lockdown
- Browser Exam Keys are generated and validated to ensure config integrity

## Important Implementation Notes

### Canvas Quiz Types
The application supports both **Classic Quizzes** and **New Quizzes** (LTI-based). New Quizzes require different API endpoints (GraphQL or Assignments API) compared to Classic Quizzes (REST API).

### Environment Configuration
- **Dev**: Uses `application-dev.properties` with Firestore database `seb-canvaslti-dev`
- **Prod**: Uses `application-prod.properties` with Firestore database `seb-canvaslti-prod`
- Secrets are injected via GCP Secret Manager, NOT environment variables directly
- Critical secrets: `LTI_CLIENT_ID`, `LTI_PRIVATE_KEY`, `TOOL_URL`, `ADMIN_PASSWORD`

### LTI Configuration
- Public JWK endpoint at `/lti/.well-known/jwks.json` (served by `JwkController`)
- Private key stored in Secret Manager as `LTI_PRIVATE_KEY` (or `dev_lti_private_key`)
- Tool URL must match registered LTI Developer Key in Canvas
- Deep Linking support for adding SEB quiz links to Canvas modules

### Canvas API OAuth2
- Redirect URI must be pre-registered in Canvas Developer Key settings
- Current dev redirect: `https://canvas-seb-dev-184075650720.us-central1.run.app/api/oauth2callback`
- Tokens are user-specific and stored in Firestore, cached in-memory for performance
- Scopes required: course content read/write, module management

### Security Considerations
- CSRF protection via encrypted state parameters (AES-256 with static key `STATE_ENCRYPTION_KEY`)
- Session management with HttpSession for LTI launch data
- Spring Security configured to permit LTI endpoints while protecting admin routes
- SEB detection prevents non-SEB browsers from accessing protected quizzes

## Development Workflow

### Adding New Features
1. Services should be created in `service/` package and implement appropriate interfaces
2. Controllers follow REST conventions and use Thymeleaf for HTML responses
3. Firestore repositories extend `FirestoreQuizRepository`, `FirestoreSebSettingRepository`, etc.
4. All Canvas API calls should use `CanvasApiService` with proper OAuth token management

### Testing
- Unit tests should mock Firestore, Canvas API, and LTI services
- Integration tests may require GCP emulator or test Firestore database
- Use `@Qualifier("oauthCanvasService")` when injecting `CanvasService` implementations

### Debugging
- Enable debug mode with `DEBUG_MODE=true` environment variable
- Access debug endpoints at `/debug/*` (see `DebugController`)
- Logging configured at DEBUG level for `org.kentdenver.sebcanvas` package in dev

### Common Pitfalls
- **OAuth Token Confusion**: LTI tokens ≠ Canvas API tokens. Use session for LTI context, Firestore for API tokens
- **Firestore Query Limits**: Firestore queries may have eventual consistency; use document IDs when possible
- **SEB File Format**: .seb files must be exactly formatted (prefix + XML + GZIP) or SEB will reject them
- **Canvas Module Updates**: Require proper OAuth scopes and may fail silently if user lacks permissions
- **Secret Manager Latency**: Use prefetch and caching (`SecretManagerService`) to avoid startup delays

## Repository Structure

```
src/main/java/org/kentdenver/sebcanvas/
├── config/          # Spring configuration (Security, LTI, OAuth2, GCP)
├── controller/      # HTTP endpoints (LTI, Quiz, OAuth, SEB, Debug)
├── service/         # Business logic (Canvas API, SEB, Quiz, Auth)
├── repository/      # Firestore data access layer
├── model/           # Domain objects (Quiz, SebConfig, QuizSebSetting, OAuthToken)
├── util/            # Utilities (SebConfigGenerator, SebDetector)
└── dto/             # Data transfer objects

src/main/resources/
├── templates/       # Thymeleaf HTML templates
├── static/          # Static assets (CSS, JS)
└── application*.properties  # Environment-specific configuration
```

## External Dependencies

- Canvas LTI 1.3 specification and OpenID Connect flows
- Safe Exam Browser file format and config key specifications
- Google Cloud Firestore for data persistence
- Google Cloud Secret Manager for secrets
- Canvas REST API and (potentially) GraphQL API for New Quizzes
