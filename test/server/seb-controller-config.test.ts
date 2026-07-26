import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import * as plist from "plist";
import { AppConfig } from "../../src/server/config/app-config.js";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

const CANVAS_URL = "https://canvas.example.edu";
const TOOL_URL = "https://tool.example.edu";
const TEST_PUBLIC_KEY_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
  type: "pkcs1",
  format: "pem"
}) as string;

describe("SEB config downloads", () => {
  it("accepts the Windows HEAD probe without consuming the configuration grant", async () => {
    const configGrants = {
      validateGrant: vi.fn().mockResolvedValue(true),
      consumeGrant: vi.fn()
    };
    const controller = new SebController(
      new AppConfig(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      proofService(),
      configGrants as any,
      admissionDouble()
    );
    const response = responseDouble();

    await controller.inspectConfigDownload(response as any, "11825", "classicquiz_23455", "a".repeat(43));

    expect(configGrants.validateGrant).toHaveBeenCalledWith("a".repeat(43), "11825", "classicquiz_23455");
    expect(configGrants.consumeGrant).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.type).toHaveBeenCalledWith("application/octet-stream");
  });

  it("uses a fresh Canvas session URL only while creating a connected student's SEB config", async () => {
    await withConfig(async () => {
      const sebConfig = new SebConfigurationService(new AppConfig());
      vi.spyOn(sebConfig, "prepareSebConfigurationDownload").mockImplementation((plaintext) => plaintext);
      const canvasApi = {
        hasAccessToken: vi.fn().mockResolvedValue(true),
        getSessionToken: vi.fn().mockResolvedValue("https://canvas.example.edu/login/session_token?opaque=secret")
      };
      const sessionHandoff = { registerConfig: vi.fn().mockResolvedValue(undefined) };
      const controller = new SebController(
        new AppConfig(),
        {} as any,
        {} as any,
        {
          isAssessmentAvailableForLearner: async () => true,
          getAssessmentRecord: async () => assessmentRecord("classicquiz_23455", "CLASSIC_QUIZ"),
          getSebSettingForQuiz: async () => ({
            quizId: "23455",
            courseId: "11825",
            sebRequired: true,
            enabled: true,
            accessCode: "ACCESS-CODE",
            ssoDomains: [],
            educationalToolDomains: [],
            customDomains: [],
            externalTools: []
          }),
          getQuiz: async () => ({
            id: "23455",
            courseId: "11825",
            title: "Midterm",
            htmlUrl: `${CANVAS_URL}/courses/11825/quizzes/23455`
          })
        } as any,
        {} as any,
        sebConfig,
        new SebConfigKeyService(),
        proofService(),
        configGrantDouble(),
        admissionDouble(),
        canvasApi as any,
        sessionHandoff as any
      );
      const setting = {
        quizId: "23455",
        courseId: "11825",
        sebRequired: true,
        enabled: true,
        accessCode: "ACCESS-CODE",
        ssoDomains: ["accounts.google.com"],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      };

      const generated = await (controller as any).generateConfigForGrant(
        "11825",
        "classicquiz_23455",
        { setting, settingsFingerprint: "settings-fingerprint" },
        "7288",
        true
      );
      const parsed = plist.parse(generated.toString("utf8")) as Record<string, unknown>;

      expect(canvasApi.getSessionToken).toHaveBeenCalledWith("7288", `${CANVAS_URL}/courses/11825/quizzes/23455/take`);
      expect(parsed.startURL).toBe("https://canvas.example.edu/login/session_token?opaque=secret");
      expect(JSON.stringify(parsed.URLFilterRules)).not.toContain("accounts.google.com");
      expect(sessionHandoff.registerConfig).toHaveBeenCalledWith(
        "11825",
        "classicquiz_23455",
        "settings-fingerprint",
        expect.stringMatching(/^[a-f0-9]{64}$/u),
        `${CANVAS_URL}/courses/11825/quizzes/23455/take`
      );
    });
  });

  it("uses canonical Canvas quiz URLs instead of student-specific canvas_url query values", async () => {
    await withConfig(
      async () => {
        const sebConfig = new SebConfigurationService(new AppConfig());
        const prepareDownload = vi
          .spyOn(sebConfig, "prepareSebConfigurationDownload")
          .mockImplementation((plaintext) => plaintext);
        const controller = new SebController(
          new AppConfig(),
          {} as any,
          {} as any,
          {
            isAssessmentAvailableForLearner: async () => true,
            getAssessmentRecord: async () => assessmentRecord("classicquiz_23455", "CLASSIC_QUIZ"),
            getSebSettingForQuiz: async () => ({
              quizId: "23455",
              courseId: "11825",
              sebRequired: true,
              enabled: true,
              accessCode: "ACCESS-CODE",
              ssoDomains: [],
              educationalToolDomains: [],
              customDomains: [],
              externalTools: []
            }),
            getQuiz: async () => ({
              id: "23455",
              courseId: "11825",
              title: "Midterm",
              htmlUrl: `${CANVAS_URL}/courses/11825/quizzes/23455?module_item_id=44`
            })
          } as any,
          {} as any,
          sebConfig,
          new SebConfigKeyService(),
          proofService(),
          configGrantDouble(),
          admissionDouble()
        );

        const generated = await downloadConfig(
          controller,
          `${CANVAS_URL}/courses/11825/quizzes/23455/take?user_id=7288&attempt=1`
        );
        const parsed = plist.parse(generated.toString("utf8")) as Record<string, unknown>;

        expect(parsed.startURL).toBe(`${CANVAS_URL}/courses/11825/quizzes/23455/take`);
        expect(parsed.restartExamURL).toBe(`${CANVAS_URL}/courses/11825/quizzes/23455/take`);
        expect(prepareDownload).toHaveBeenCalledWith(generated, {
          startPassword: undefined
        });
      },
      { encryptionEnabled: true }
    );
  });

  it("uses stable Canvas assignment entry URLs for New Quiz configs", async () => {
    await withConfig(
      async () => {
        const sebConfig = new SebConfigurationService(new AppConfig());
        const prepareDownload = vi
          .spyOn(sebConfig, "prepareSebConfigurationDownload")
          .mockImplementation((plaintext) => plaintext);
        const controller = new SebController(
          new AppConfig(),
          {} as any,
          {} as any,
          {
            isAssessmentAvailableForLearner: async () => true,
            getAssessmentRecord: async () => assessmentRecord("newquiz:11825:991", "NEW_QUIZ"),
            getContentSebSetting: async () => ({
              contentId: "newquiz:11825:991",
              courseId: "11825",
              assignmentId: "991",
              canvasId: "991",
              htmlUrl: `${CANVAS_URL}/courses/11825/assignments/991?module_item_id=44`,
              sebRequired: true,
              enabled: true,
              accessCode: "ACCESS-CODE",
              ssoDomains: [],
              educationalToolDomains: [],
              customDomains: [],
              externalTools: []
            }),
            getContentItem: async () => ({
              id: "newquiz:11825:991",
              courseId: "11825",
              canvasId: "991",
              assignmentId: "991",
              contentType: "NEW_QUIZ",
              title: "New Quiz",
              // A stale or poisoned cached URL must not override the assessment's
              // signed course and canonical assignment identifiers.
              htmlUrl: `${CANVAS_URL}/courses/99999/assignments/777/taking/8888/take?module_item_id=44`
            })
          } as any,
          {} as any,
          sebConfig,
          new SebConfigKeyService(),
          proofService(),
          configGrantDouble(),
          admissionDouble()
        );

        const generated = await downloadConfig(
          controller,
          `${CANVAS_URL}/courses/11825/assignments/991/taking/31299/take`,
          "newquiz:11825:991"
        );
        const parsed = plist.parse(generated.toString("utf8")) as Record<string, unknown>;

        expect(parsed.startURL).toBe(`${CANVAS_URL}/courses/11825/assignments/991`);
        expect(parsed.restartExamURL).toBe(`${CANVAS_URL}/courses/11825/assignments/991`);
        expect(prepareDownload).toHaveBeenCalledWith(generated, {
          startPassword: undefined
        });
      },
      { encryptionEnabled: true }
    );
  });

  it("encrypts downloaded assessment configs without persisting a replayable Config Key", async () => {
    await withConfig(
      async () => {
        const saveConfigKey = vi.fn(async (setting, configKey) => ({ ...setting, configKey }));
        const controller = new SebController(
          new AppConfig(),
          {} as any,
          {} as any,
          {
            isAssessmentAvailableForLearner: async () => true,
            getAssessmentRecord: async () => assessmentRecord("classicquiz_23455", "CLASSIC_QUIZ"),
            getSebSettingForQuiz: async () => ({
              quizId: "23455",
              courseId: "11825",
              sebRequired: true,
              enabled: true,
              accessCode: "ACCESS-CODE",
              ssoDomains: [],
              educationalToolDomains: [],
              customDomains: [],
              externalTools: []
            }),
            getQuiz: async () => ({
              id: "23455",
              courseId: "11825",
              title: "Midterm",
              htmlUrl: `${CANVAS_URL}/courses/11825/quizzes/23455`
            }),
            saveQuizConfigKeyIfUnchanged: saveConfigKey
          } as any,
          {} as any,
          new SebConfigurationService(new AppConfig()),
          new SebConfigKeyService(),
          proofService(),
          configGrantDouble(),
          admissionDouble()
        );

        const downloaded = await downloadConfig(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`);
        const unzipped = gunzipSync(downloaded);
        const plaintext = new SebConfigurationService(new AppConfig()).generateSebConfiguration({
          courseId: "11825",
          contentId: "classicquiz_23455",
          startUrl: `${CANVAS_URL}/courses/11825/quizzes/23455/take`,
          accessCode: "ACCESS-CODE",
          allowedDomains: [],
          quitPassword: undefined
        });

        expect(unzipped.subarray(0, 4).toString("utf8")).toBe("pkhs");
        expect(downloaded.toString("utf8")).not.toContain("<plist");
        expect(new SebConfigKeyService().computeConfigKey(plaintext)).toMatch(/^[a-f0-9]{64}$/u);
        expect(saveConfigKey).not.toHaveBeenCalled();
      },
      { encryptionEnabled: true }
    );
  });

  it("keeps start-password settings inside the certificate-encrypted assessment download", async () => {
    await withConfig(
      async () => {
        const saveConfigKey = vi.fn(async (setting, configKey) => ({ ...setting, configKey }));
        const configKeySalt = Buffer.alloc(32, 9).toString("base64");
        const sebConfig = new SebConfigurationService(new AppConfig());
        const prepareDownload = vi.spyOn(sebConfig, "prepareSebConfigurationDownload");
        const controller = new SebController(
          new AppConfig(),
          {} as any,
          {} as any,
          {
            isAssessmentAvailableForLearner: async () => true,
            getAssessmentRecord: async () => assessmentRecord("classicquiz_23455", "CLASSIC_QUIZ"),
            getSebSettingForQuiz: async () => ({
              quizId: "23455",
              courseId: "11825",
              sebRequired: true,
              enabled: true,
              accessCode: "ACCESS-CODE",
              startPassword: "unique-start-passphrase",
              configKeySalt,
              ssoDomains: [],
              educationalToolDomains: [],
              customDomains: [],
              externalTools: []
            }),
            getQuiz: async () => ({
              id: "23455",
              courseId: "11825",
              title: "Midterm",
              htmlUrl: `${CANVAS_URL}/courses/11825/quizzes/23455`
            }),
            saveQuizConfigKeyIfUnchanged: saveConfigKey
          } as any,
          {} as any,
          sebConfig,
          new SebConfigKeyService(),
          proofService(),
          configGrantDouble(),
          admissionDouble()
        );

        const downloaded = await downloadConfig(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`);
        const wrapped = gunzipSync(downloaded);

        expect(wrapped.subarray(0, 4).toString("utf8")).toBe("pkhs");
        expect(downloaded.toString("utf8")).not.toContain("unique-start-passphrase");
        expect(prepareDownload).toHaveBeenCalledWith(expect.any(Buffer), {
          startPassword: "unique-start-passphrase"
        });
        expect(saveConfigKey).not.toHaveBeenCalled();
      },
      { encryptionEnabled: true }
    );
  });

  it("delivers plaintext assessment configs when instance certificate encryption is disabled", async () => {
    await withConfig(
      async () => {
        const controller = classicController(new SebConfigurationService(new AppConfig()));
        const response = await downloadConfigResponse(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`);

        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.sent).toBeInstanceOf(Buffer);
        expect((response.sent as Buffer).toString("utf8")).toContain("<plist");
      },
      { encryptionEnabled: false }
    );
  });

  it("rejects a config download when the assessment is owned by another course", async () => {
    await withConfig(
      async () => {
        const controller = classicController(new SebConfigurationService(new AppConfig()), "different-course");
        const response = await downloadConfigResponse(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`);

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.sent).toBe(
          "Unable to generate this Safe Online Exam configuration. Ask the instructor to verify the quiz settings."
        );
      },
      { encryptionEnabled: true }
    );
  });

  it("single-flights concurrent grants when a persisted start-password salt is stable", async () => {
    await withConfig(
      async () => {
        const configKeySalt = Buffer.alloc(32, 7).toString("base64");
        const sebConfig = new SebConfigurationService(new AppConfig());
        const prepareDownload = vi
          .spyOn(sebConfig, "prepareSebConfigurationDownload")
          .mockImplementation((plaintext) => plaintext);
        const readinessCheck = vi.spyOn(sebConfig, "assertConfigurationDownloadReady");
        const controller = new SebController(
          new AppConfig(),
          {} as any,
          {} as any,
          {
            isAssessmentAvailableForLearner: async () => true,
            getAssessmentRecord: async () => assessmentRecord("classicquiz_23455", "CLASSIC_QUIZ"),
            getSebSettingForQuiz: async () => ({
              quizId: "23455",
              courseId: "11825",
              sebRequired: true,
              enabled: true,
              accessCode: "ACCESS-CODE",
              startPassword: "unique-start-passphrase",
              configKeySalt,
              ssoDomains: [],
              educationalToolDomains: [],
              customDomains: [],
              urlRules: [],
              externalTools: []
            }),
            getQuiz: async () => ({ id: "23455", courseId: "11825", title: "Midterm" })
          } as any,
          {} as any,
          sebConfig,
          new SebConfigKeyService(),
          proofService(),
          configGrantDouble(),
          admissionDouble()
        );

        const [first, second] = await Promise.all([
          downloadConfigResponse(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`),
          downloadConfigResponse(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`)
        ]);

        expect(first.sent).toBeInstanceOf(Buffer);
        expect(second.sent).toBeInstanceOf(Buffer);
        expect(prepareDownload).toHaveBeenCalledTimes(1);
        expect(readinessCheck).toHaveBeenCalledTimes(2);
      },
      { encryptionEnabled: true }
    );
  });

  it("rechecks encryption readiness before serving cached assessment bytes", async () => {
    await withConfig(
      async () => {
        const sebConfig = new SebConfigurationService(new AppConfig());
        const prepareDownload = vi
          .spyOn(sebConfig, "prepareSebConfigurationDownload")
          .mockImplementation((plaintext) => plaintext);
        const readinessCheck = vi
          .spyOn(sebConfig, "assertConfigurationDownloadReady")
          .mockImplementationOnce(() => undefined)
          .mockImplementationOnce(() => {
            throw new Error("SEB config encryption certificate has expired");
          });
        const controller = classicController(sebConfig);

        const first = await downloadConfigResponse(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`);
        const second = await downloadConfigResponse(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`);

        expect(first.sent).toBeInstanceOf(Buffer);
        expect(second.status).toHaveBeenCalledWith(400);
        expect(second.sent).toBe(
          "Unable to generate this Safe Online Exam configuration. Ask the instructor to verify the quiz settings."
        );
        expect(prepareDownload).toHaveBeenCalledTimes(1);
        expect(readinessCheck).toHaveBeenCalledTimes(2);
      },
      { encryptionEnabled: true }
    );
  });

  it("rejects anonymous config downloads before any expensive configuration work", async () => {
    await withConfig(
      async () => {
        const sebConfig = new SebConfigurationService(new AppConfig());
        const prepareDownload = vi.spyOn(sebConfig, "prepareSebConfigurationDownload");
        const controller = classicController(sebConfig);
        let sent: unknown;
        const response = {
          status: vi.fn(() => response),
          type: vi.fn(() => response),
          setHeader: vi.fn(() => response),
          send: vi.fn((body: unknown) => {
            sent = body;
            return response;
          })
        } as any;

        await controller.downloadConfig(
          {
            ip: "192.0.2.44",
            socket: { remoteAddress: "192.0.2.44" },
            header: () => undefined
          } as any,
          response,
          "11825",
          "classicquiz_23455",
          undefined
        );

        expect(response.status).toHaveBeenCalledWith(403);
        expect(sent).toBe("Invalid or expired configuration grant");
        expect(prepareDownload).not.toHaveBeenCalled();
      },
      { encryptionEnabled: true }
    );
  });

  it("rejects a grant after the assessment settings fingerprint changes", async () => {
    await withConfig(
      async () => {
        const setting = {
          quizId: "23455",
          courseId: "11825",
          sebRequired: true,
          enabled: true,
          accessCode: "ACCESS-ONE",
          ssoDomains: [],
          educationalToolDomains: [],
          customDomains: [],
          urlRules: [],
          externalTools: []
        };
        const sebConfig = new SebConfigurationService(new AppConfig());
        const prepareDownload = vi.spyOn(sebConfig, "prepareSebConfigurationDownload");
        const controller = new SebController(
          new AppConfig(),
          {} as any,
          {} as any,
          {
            isAssessmentAvailableForLearner: async () => true,
            getSebSettingForQuiz: async () => setting,
            getAssessmentRecord: async () => assessmentRecord("classicquiz_23455", "CLASSIC_QUIZ"),
            getQuiz: async () => ({ id: "23455", courseId: "11825", title: "Midterm" })
          } as any,
          {} as any,
          sebConfig,
          new SebConfigKeyService(),
          proofService(),
          configGrantDouble(),
          admissionDouble()
        );
        const request = authenticatedRequest();
        const target = await (controller as any).resolveConfigGrantTarget("11825", "23455");
        const grant = await (controller as any).configGrants.mintGrant(
          request,
          request.session.verifiedLtiPrincipal,
          "11825",
          target.canonicalContentId,
          target.settingsFingerprint
        );
        setting.accessCode = "ACCESS-TWO";
        const response = responseDouble();

        await controller.downloadConfig(request, response as any, "11825", "classicquiz_23455", grant);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.send).toHaveBeenCalledWith("Invalid or expired configuration grant");
        expect(prepareDownload).not.toHaveBeenCalled();
      },
      { encryptionEnabled: true }
    );
  });
});

function proofService(): SebAccessProofService {
  return new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);
}

function configGrantDouble() {
  return {
    mintGrant: vi.fn(async (_request, _principal, _courseId, _contentId, settingsFingerprint) =>
      String(settingsFingerprint)
    ),
    consumeGrant: vi.fn(async (token, courseId, contentId) =>
      token
        ? {
            issuer: "https://canvas.example.edu",
            deploymentId: "deployment-1",
            subject: "opaque-student-1",
            courseId,
            contentId,
            settingsFingerprint: token
          }
        : null
    )
  } as any;
}

function admissionDouble() {
  return { consumeRequestIp: vi.fn().mockResolvedValue(true) } as any;
}

function authenticatedRequest(): any {
  return {
    ip: "192.0.2.15",
    socket: { remoteAddress: "192.0.2.15" },
    protocol: "https",
    hostname: "tool.example.edu",
    originalUrl: "/seb/launch/classicquiz_23455",
    sessionID: "session-1",
    session: {
      verifiedLtiPrincipal: {
        version: 1,
        issuer: "https://canvas.example.edu",
        deploymentId: "deployment-1",
        subject: "opaque-student-1",
        canvasUserId: "student-1",
        courseId: "11825",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
        custom: {},
        authenticatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    get: (name: string) => (name.toLowerCase() === "host" ? "tool.example.edu" : undefined),
    header: () => undefined
  };
}

function responseDouble(): any {
  const response = {
    status: vi.fn(),
    type: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.setHeader.mockReturnValue(response);
  return response;
}

async function downloadConfig(
  controller: SebController,
  canvasUrl: string,
  contentId = "classicquiz_23455"
): Promise<Buffer> {
  const result = await downloadConfigResponse(controller, canvasUrl, contentId);
  expect(result.sent).toBeInstanceOf(Buffer);
  return result.sent as Buffer;
}

async function downloadConfigResponse(
  controller: SebController,
  _canvasUrl: string,
  contentId = "classicquiz_23455"
): Promise<{ sent: unknown; status: ReturnType<typeof vi.fn> }> {
  let sent: unknown;
  const response = {
    status: vi.fn(() => response),
    type: vi.fn(() => response),
    setHeader: vi.fn(() => response),
    send: vi.fn((body: unknown) => {
      sent = body;
      return response;
    })
  } as any;
  const request = {
    ip: "192.0.2.15",
    protocol: "https",
    hostname: "tool.example.edu",
    originalUrl: `/seb/config/11825/${contentId}.seb`,
    get: (name: string) => (name.toLowerCase() === "host" ? "tool.example.edu" : undefined),
    header: () => undefined
  } as any;
  const principal = {
    version: 1,
    issuer: "https://canvas.example.edu",
    deploymentId: "deployment-1",
    subject: "opaque-student-1",
    canvasUserId: "student-1",
    courseId: "11825",
    roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
    custom: {},
    authenticatedAt: "2026-01-01T00:00:00.000Z"
  };
  const authenticated = { ...request, sessionID: "session-1", session: { verifiedLtiPrincipal: principal } };
  const target = await (controller as any).resolveConfigGrantTarget("11825", contentId);
  const grant = await (controller as any).configGrants.mintGrant(
    authenticated,
    principal,
    "11825",
    target.canonicalContentId,
    target.settingsFingerprint
  );
  await controller.downloadConfig(request, response, "11825", contentId, grant);
  return { sent, status: response.status };
}

function classicController(sebConfig: SebConfigurationService, recordCourseId = "11825"): SebController {
  return new SebController(
    new AppConfig(),
    {} as any,
    {} as any,
    {
      isAssessmentAvailableForLearner: async () => true,
      getAssessmentRecord: async () => assessmentRecord("classicquiz_23455", "CLASSIC_QUIZ", recordCourseId),
      getSebSettingForQuiz: async () => ({
        quizId: "23455",
        courseId: "11825",
        sebRequired: true,
        enabled: true,
        accessCode: "ACCESS-CODE",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      }),
      getQuiz: async () => ({
        id: "23455",
        courseId: "11825",
        title: "Midterm",
        htmlUrl: `${CANVAS_URL}/courses/11825/quizzes/23455`
      })
    } as any,
    {} as any,
    sebConfig,
    new SebConfigKeyService(),
    proofService(),
    configGrantDouble(),
    admissionDouble()
  );
}

function assessmentRecord(
  id: string,
  contentType: "CLASSIC_QUIZ" | "NEW_QUIZ",
  courseId = "11825"
): Record<string, unknown> {
  const canvasId = contentType === "CLASSIC_QUIZ" ? "23455" : "991";
  return {
    id,
    courseId,
    contentType,
    canvas: {
      id: canvasId,
      ...(contentType === "CLASSIC_QUIZ" ? { quizId: canvasId } : { assignmentId: canvasId }),
      title: contentType === "CLASSIC_QUIZ" ? "Midterm" : "New Quiz"
    },
    seb: {
      required: true,
      enabled: true,
      accessCode: "ACCESS-CODE",
      usesCourseDefaults: true,
      quitPasswordOverride: false,
      startPasswordOverride: false,
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: []
    }
  };
}

async function withConfig(run: () => Promise<void>, options: { encryptionEnabled?: boolean } = {}): Promise<void> {
  const previousCanvasBaseUrl = process.env.CANVAS_BASE_URL;
  const previousToolUrl = process.env.TOOL_URL;
  const previousEncryptionEnabled = process.env.SEB_CONFIG_ENCRYPTION_ENABLED;
  const previousPublicKeyPem = process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM;
  const previousQuitPassword = process.env.SEB_QUIT_PASSWORD;
  process.env.CANVAS_BASE_URL = CANVAS_URL;
  process.env.TOOL_URL = TOOL_URL;
  process.env.SEB_CONFIG_ENCRYPTION_ENABLED = options.encryptionEnabled ? "true" : "false";
  process.env.SEB_QUIT_PASSWORD = "managed-server-exit";
  if (options.encryptionEnabled) {
    process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM = TEST_PUBLIC_KEY_PEM;
  } else {
    delete process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM;
  }
  try {
    await run();
  } finally {
    restoreEnv("CANVAS_BASE_URL", previousCanvasBaseUrl);
    restoreEnv("TOOL_URL", previousToolUrl);
    restoreEnv("SEB_CONFIG_ENCRYPTION_ENABLED", previousEncryptionEnabled);
    restoreEnv("SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM", previousPublicKeyPem);
    restoreEnv("SEB_QUIT_PASSWORD", previousQuitPassword);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
