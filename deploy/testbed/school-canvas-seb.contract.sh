# Public, non-secret contract for the isolated self-hosted Canvas testbed.
# Secret payloads remain in Secret Manager; only immutable version references live here.
readonly TESTBED_PROJECT_ID="seb-for-canvas"
readonly TESTBED_REGION="us-central1"
readonly TESTBED_SERVICE="school-canvas-seb"
readonly TESTBED_CANVAS_DOMAIN="https://canvas-test.apps.jacobbarkin.com"
readonly TESTBED_TOOL_URL="https://seb.jacobbarkin.com"
readonly TESTBED_LTI_AUTH_URL="https://canvas-test.apps.jacobbarkin.com/api/lti/authorize_redirect"
readonly TESTBED_LTI_CLIENT_ID="10000000000002"
readonly TESTBED_LTI_DEPLOYMENT_ID="1:276ac1e5d77509bef8b8ad3c104fc824f7fb6de9"
readonly TESTBED_SCHEMA_COMPATIBILITY_PROFILE="google-docs-stage2-v7"

readonly TESTBED_LTI_CLIENT_ID_SECRET_VERSION="6"
readonly TESTBED_CANVAS_API_CLIENT_ID_SECRET_VERSION="7"
readonly TESTBED_SECRET_BINDINGS="CANVAS_DOMAIN=school_canvas_seb_canvas_domain:6,LTI_CLIENT_ID=school_canvas_seb_lti_client_id:${TESTBED_LTI_CLIENT_ID_SECRET_VERSION},LTI_DEPLOYMENT_ID=school_canvas_seb_lti_deployment_id:6,TOOL_URL=school_canvas_seb_tool_url:6,LTI_PRIVATE_KEY=school_canvas_seb_lti_private_key:6,SESSION_SECRET=school_canvas_seb_session_secret:6,STATE_ENCRYPTION_KEY=school_canvas_seb_state_encryption_key:6,OAUTH_TOKEN_ENCRYPTION_KEYRING=school_canvas_seb_oauth_token_encryption_keyring:1,CANVAS_API_CLIENT_ID=school_canvas_seb_api_client_id:${TESTBED_CANVAS_API_CLIENT_ID_SECRET_VERSION},CANVAS_API_CLIENT_SECRET=school_canvas_seb_api_client_secret:6,SEB_CONFIG_ENCRYPTION_CERT_PEM=school_canvas_seb_seb_config_encryption_cert_pem:6,DATABASE_PASSWORD=school_canvas_seb_database_password:1"
