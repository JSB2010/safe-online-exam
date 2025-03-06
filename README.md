# Canvas Safe Exam Browser Integration

## Overview

The Canvas SEB Integration is a Spring Boot application that integrates Canvas Learning Management System (LMS) with Safe Exam Browser (SEB) using the Learning Tools Interoperability (LTI) v1.3 standard. This tool allows instructors to enforce the use of SEB for specific quizzes, providing a secure testing environment for students.

## Project Goals

- Enable instructors to designate which Canvas quizzes require SEB
- Enforce SEB usage for secure quiz taking
- Dynamically generate SEB configurations for quizzes
- Seamlessly integrate with Canvas via LTI 1.3
- Deploy as a scalable service on Google Cloud Platform

## Project Structure

```
src/
├── main/
│   ├── java/
│   │   └── org/
│   │       └── kentdenver/
│   │           └── sebcanvas/
│   │               ├── CanvasSebApplication.java
│   │               ├── config/
│   │               │   ├── AppConfig.java
│   │               │   ├── CloudSqlConfig.java
│   │               │   ├── LtiConfig.java
│   │               │   └── SecurityConfig.java
│   │               ├── controller/
│   │               │   ├── LtiController.java
│   │               │   ├── QuizController.java
│   │               │   └── SebController.java
│   │               ├── model/
│   │               │   ├── Quiz.java
│   │               │   ├── SebConfig.java
│   │               │   └── QuizSebSetting.java
│   │               ├── repository/
│   │               │   ├── QuizRepository.java
│   │               │   └── SebSettingRepository.java
│   │               ├── service/
│   │               │   ├── CanvasService.java
│   │               │   ├── LtiService.java
│   │               │   ├── QuizService.java
│   │               │   └── SebService.java
│   │               └── util/
│   │                   ├── SebConfigGenerator.java
│   │                   └── SebDetector.java
│   └── resources/
│       ├── application.properties
│       ├── application-dev.properties
│       ├── application-prod.properties
│       ├── static/
│       │   ├── css/
│       │   │   └── main.css
│       │   ├── js/
│       │   │   └── app.js
│       │   └── images/
│       │       └── logo.png
│       └── templates/
│           ├── teacherView.html
│           └── sebRequired.html
└── test/
    └── java/
        └── org/
            └── kentdenver/
                └── sebcanvas/
                    ├── CanvasSebApplicationTests.java
                    ├── controller/
                    │   ├── LtiControllerTest.java
                    │   ├── QuizControllerTest.java
                    │   └── SebControllerTest.java
                    ├── service/
                    │   ├── CanvasServiceTest.java
                    │   ├── LtiServiceTest.java
                    │   └── SebServiceTest.java
                    └── util/
                        └── SebConfigGeneratorTest.java
```

## Technology Stack

- **Java 11**: Core programming language
- **Spring Boot 2.7.5**: Application framework
- **Spring Security**: Authentication and authorization
- **Spring Data JPA**: Data access layer
- **Thymeleaf**: Server-side Java template engine
- **Nimbus JOSE + JWT**: JSON Web Token implementation
- **PostgreSQL**: Production database (Google Cloud SQL)
- **H2 Database**: Development/testing database
- **Google Cloud Platform**:
    - Cloud Run: Container hosting
    - Cloud SQL: Managed database
    - Secret Manager: Secure credential storage
- **Bootstrap 5**: Frontend styling
- **JUnit 5**: Testing framework
- **Mockito**: Mocking framework for testing

## Prerequisites

- Java Development Kit (JDK) 11 or later
- Maven 3.6.0 or later
- Google Cloud SDK
- IntelliJ IDEA (recommended)
- Google Cloud Platform account
- Canvas LMS administrator access

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/kentdenver/canvas-seb-integration.git
cd canvas-seb-integration
```

### 2. Configure Development Properties

Edit `src/main/resources/application-dev.properties`:

```properties
# LTI Configuration
lti.issuer=https://canvas.instructure.com
lti.clientId=your_dev_client_id_here
lti.keySetUrl=https://sso.canvaslms.com/api/lti/security/jwks
lti.tokenUrl=https://sso.canvaslms.com/login/oauth2/token
lti.authUrl=https://sso.canvaslms.com/api/lti/authorize_redirect

# Canvas API
canvas.api.baseUrl=https://canvas.instructure.com/api/v1
```

### 3. Build the Project

```bash
mvn clean install
```

### 4. Run Locally

```bash
mvn spring-boot:run -Dspring.profiles.active=dev
```

The application will be available at `http://localhost:8080`

## Canvas LTI Configuration

### 1. Register the LTI Tool in Canvas

1. Navigate to your Canvas account settings
2. Click on "Developer Keys"
3. Click "+ Developer Key" and select "+LTI Key"
4. Configure with these settings:

```json
{
  "title": "Canvas SEB Integration",
  "description": "Integrate Safe Exam Browser with Canvas quizzes",
  "target_link_uri": "https://your-app-url.com/lti/launch",
  "oidc_initiation_url": "https://your-app-url.com/lti/login",
  "scopes": [
    "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
    "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
    "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly"
  ],
  "extensions": [
    {
      "domain": "your-app-url.com",
      "tool_id": "canvas-seb-integration",
      "platform": "canvas.instructure.com",
      "settings": {
        "text": "SEB Quiz Settings",
        "icon_url": "https://your-app-url.com/images/logo.png",
        "placements": [
          {
            "text": "SEB Quiz Settings",
            "placement": "course_navigation",
            "message_type": "LtiResourceLinkRequest",
            "target_link_uri": "https://your-app-url.com/lti/launch"
          }
        ]
      }
    }
  ],
  "public_jwk": {
    "kty": "RSA",
    "alg": "RS256",
    "e": "AQAB",
    "kid": "your-generated-key-id",
    "n": "your-generated-public-key-n-value",
    "use": "sig"
  }
}
```

5. Generate a secure public/private key pair for the "public_jwk" section (see Generating Keys section below)
6. Enable the developer key and copy the client ID to use in your application

### 2. Generating Keys for LTI Authentication

Use the following command to generate a RSA key pair:

```bash
# Install OpenSSL if not already available
# Generate private key
openssl genrsa -out private-key.pem 2048

# Extract public key
openssl rsa -in private-key.pem -pubout -out public-key.pem

# Format for use in Canvas Developer Key
# You'll need to format the output to match the JSON format required by Canvas
```

## Google Cloud Platform Setup

### 1. Set Up Google Cloud SQL

1. Go to the Google Cloud Console
2. Navigate to SQL > Create Instance
3. Select PostgreSQL
4. Configure your instance:
    - Name: `canvas-seb-db`
    - Password: Set a strong password
    - Region: Choose appropriate region
    - Database version: PostgreSQL 12 or later
    - Machine type: Lightweight tier for development, adjust for production
5. Under Connections, select "Private IP" (recommended for production)
6. Click "Create Instance"

After the instance is created:
1. Go to Databases and create a new database named `sebdb`
2. Go to Users and create a user for your application

### 2. Create Secrets in Secret Manager

1. Go to Google Cloud Console
2. Navigate to Security > Secret Manager
3. Create these secrets:
    - `DB_USER` - Your database username
    - `DB_PASS` - Your database password
    - `DB_NAME` - Your database name (sebdb)
    - `CLOUD_SQL_CONNECTION_NAME` - Connection name (project:region:instance)
    - `LTI_CLIENT_ID` - Your Canvas LTI client ID

### 3. Configure GCP Environment Variables

Ensure your production properties are correctly set in `application-prod.properties`:

```properties
spring.application.name=canvas-seb-integration

# Server configuration
server.port=8080

# JPA/Hibernate
spring.jpa.hibernate.ddl-auto=update
spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect

# LTI Configuration
lti.issuer=https://canvas.instructure.com
lti.clientId=${LTI_CLIENT_ID}
lti.keySetUrl=https://sso.canvaslms.com/api/lti/security/jwks
lti.tokenUrl=https://sso.canvaslms.com/login/oauth2/token
lti.authUrl=https://sso.canvaslms.com/api/lti/authorize_redirect

# Canvas API
canvas.api.baseUrl=https://canvas.instructure.com/api/v1

# SEB Configuration
seb.browserExamKeyRequired=true
seb.configKeyRequired=false
```

## Deploying to Google Cloud Platform

### 1. Install Cloud Code Plugin in IntelliJ

1. Open IntelliJ IDEA
2. Go to File > Settings > Plugins
3. Search for "Google Cloud Code"
4. Install the plugin and restart IntelliJ

### 2. Create Cloud Run Deployment Configuration

1. Click **Run** > **Edit Configurations**
2. Click the **+** button and select **Cloud Run: Deploy**
3. Configure as follows:

**Cloud Run Settings:**
- **Name**: CanvasSeb Cloud Deploy
- **GCP Project**: [Select your project]
- **Service Name**: canvas-seb
- **Region**: us-central1 (or your preferred region)
- **Deploy Revision from Source**: Select this option
- **Source Location**: Select your project directory
- **Platform**: 1st gen
- **Memory**: 512 MiB (or as needed)
- **CPU**: 1 (or as needed)
- **Timeout**: 300 seconds
- **Maximum Instances**: As needed
- **Minimum Instances**: 0
- **Environment Variables**:
    - SPRING_PROFILES_ACTIVE=prod
    - Add other variables or use secrets as needed

**Additional Settings:**
- **Connect to Cloud SQL**: Check and select your instance
- **Allow unauthenticated invocations**: Check if public access is needed

### 3. Deploy to Cloud Run

1. Select the "CanvasSeb Cloud Deploy" configuration
2. Click the "Run" button (green triangle)
3. Wait for the deployment to complete
4. Note the deployed service URL (e.g., `https://canvas-seb-abc123-uc.a.run.app`)

### 4. Update Canvas Configuration

Update your Canvas LTI Developer Key with your new Cloud Run URLs:
- `target_link_uri`: `https://your-cloud-run-url.a.run.app/lti/launch`
- `oidc_initiation_url`: `https://your-cloud-run-url.a.run.app/lti/login`

## User Workflow

### Teacher Workflow

1. Instructor navigates to a course in Canvas
2. Clicks on the "SEB Quiz Settings" in the course navigation
3. Views a list of all quizzes in the course
4. Toggles which quizzes require SEB
5. Changes are automatically saved

### Student Workflow

1. Student clicks on a quiz in Canvas
2. If SEB is required for the quiz:
    - Student is shown a page indicating SEB is required
    - Student downloads the SEB configuration file
    - Opening the file launches SEB and navigates to the quiz
3. If SEB is not required:
    - Student is taken directly to the quiz
4. After completing the quiz in SEB, student can exit the browser

## Troubleshooting

### LTI Launch Issues

- **Problem**: "Invalid token signature" error during launch
    - **Solution**: Verify your public/private key pair matches what's registered in Canvas

- **Problem**: "Invalid client ID" error
    - **Solution**: Ensure the client ID in your application matches the one in Canvas

### SEB Configuration Issues

- **Problem**: SEB doesn't launch correctly
    - **Solution**: Check that the generated SEB file is properly formatted and contains the correct Canvas URL

- **Problem**: SEB detects student but quiz doesn't load
    - **Solution**: Verify the browser exam key validation process and URL filter settings

### Cloud SQL Connection Issues

- **Problem**: Application can't connect to database
    - **Solution**: Check network permissions, connection name, and credentials

### Cloud Run Deployment Issues

- **Problem**: Deployment fails
    - **Solution**: Check logs for detailed error information, verify GCP permissions

## Security Considerations

- All communication uses HTTPS
- LTI 1.3 security standards are implemented
- Credentials are stored in GCP Secret Manager
- Spring Security controls access to endpoints
- SEB browser detection validates secure environment

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Safe Exam Browser](https://safeexambrowser.org) for providing the secure browser environment
- [IMS Global](https://www.imsglobal.org) for the LTI specification
- [Canvas LMS](https://www.instructure.com/canvas) for their LTI implementation

---

Developed by Kent Denver School, 2023