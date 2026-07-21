import { describe, expect, it, vi } from "vitest";
import { createSebConfigGrantActionToken } from "../../src/server/http/action-token.js";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import {
  createLtiOidcBrowserTransaction,
  LTI_OIDC_BROWSER_BINDING_FIELD,
  LTI_OIDC_TRANSACTION_ID_FIELD
} from "../../src/server/security/lti-oidc-browser-binding.js";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

const BROWSER_TRANSACTION = createLtiOidcBrowserTransaction();

describe("SebController route contracts", () => {
  it("redirects Classic Quiz enforcement when SEB is not required", async () => {
    const response = responseDouble();
    const { controller } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({ sebRequired: false })
      }
    });

    await controller.enforceQuiz(requestDouble(), response, "course-1", "23455");

    expect(response.redirect).toHaveBeenCalledWith("https://canvas.example.edu/courses/course-1/quizzes/23455/take");
  });

  it("renders the SEB-required app shell when a browser opens a required Classic Quiz", async () => {
    const response = responseDouble();
    const { controller, sebDetector } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          accessCode: "ACCESS"
        })
      }
    });
    sebDetector.isRequestFromSeb.mockReturnValue(false);

    await controller.enforceQuiz(
      requestDouble(),
      response,
      "course-1",
      "23455",
      "https://canvas.example.edu/courses/course-1/quizzes/23455",
      "student-1"
    );

    const html = response.send.mock.calls[0][0] as string;
    expect(html).toContain('"view":"seb-required"');
    expect(html).toContain("/api/seb/config-grant/course-1/classicquiz_23455");
    expect(html).not.toContain("?grant=");
  });

  it("returns only enabled external tools for SEB-required settings", async () => {
    const { controller } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          externalTools: [
            { id: "calc", label: "Calculator", url: "calc.example.edu", enabled: true },
            { id: "notes", label: "Notes", url: "https://notes.example.edu", enabled: false }
          ]
        })
      }
    });

    await expect(controller.tools(requestDouble(), "course-1", "23455")).resolves.toEqual({
      success: true,
      tools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu/" }]
    });
  });

  it("opens YouTube through the server-owned player page and regular tools directly", async () => {
    const { controller } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          externalTools: [
            {
              id: "video",
              label: "Class video",
              url: "https://www.youtube.com/embed/qZ7OjpjGVGs?rel=0",
              preset: "youtube-video",
              enabled: true
            },
            {
              id: "sheet",
              label: "Reference sheet",
              url: "https://docs.google.com/spreadsheets/d/1A2b_3-c/edit?usp=sharing",
              enabled: true
            }
          ]
        })
      }
    });

    await expect(controller.tools(requestDouble(), "course-1", "23455")).resolves.toEqual({
      success: true,
      tools: [
        { id: "video", label: "Class video", url: "https://tool.example.edu/seb/tool/youtube/qZ7OjpjGVGs" },
        {
          id: "sheet",
          label: "Reference sheet",
          url: "https://docs.google.com/spreadsheets/d/1A2b_3-c/edit?usp=sharing"
        }
      ]
    });
  });

  it("serves a YouTube embedding document with the configured origin and rejects invalid video IDs", () => {
    const { controller } = controllerWith();
    const videoResponse = responseDouble();
    controller.youtubeTool("qZ7OjpjGVGs", videoResponse);

    expect(videoResponse.setHeader).toHaveBeenCalledWith("referrer-policy", "strict-origin-when-cross-origin");
    expect(videoResponse.send).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://www.youtube.com/embed/qZ7OjpjGVGs?rel=0&amp;origin=https%3A%2F%2Ftool.example.edu"
      )
    );

    const invalidResponse = responseDouble();
    controller.youtubeTool("not-a-video-id", invalidResponse);
    expect(invalidResponse.status).toHaveBeenCalledWith(404);
  });

  it("gates access-code retrieval with one-time proof tokens", async () => {
    const proofService = new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);
    const { controller } = controllerWith({
      proofService,
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          quizId: "23455",
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          accessCode: "ACCESS-CODE",
          ssoDomains: [],
          educationalToolDomains: [],
          urlRules: [],
          externalTools: []
        }),
        getQuiz: vi.fn().mockResolvedValue({
          id: "23455",
          courseId: "course-1",
          htmlUrl: "https://canvas.example.edu/courses/course-1/quizzes/23455"
        })
      }
    });
    const quizUrl = "https://canvas.example.edu/courses/course-1/quizzes/23455/take";
    const configKeyService = new SebConfigKeyService();
    const currentConfigKey = configKeyService.computeConfigKey(
      new SebConfigurationService(configDouble() as any).generateSebConfiguration({
        courseId: "course-1",
        contentId: "classicquiz_23455",
        startUrl: quizUrl,
        accessCode: "ACCESS-CODE",
        allowedDomains: []
      })
    );
    const proof = await controller.createAccessProof(
      requestDouble("/api/seb/access-proof/course-1/23455"),
      "course-1",
      "23455",
      {
        configKeyHash: configKeyService.hashForUrl(quizUrl, currentConfigKey),
        url: quizUrl
      }
    );
    const proofToken = proof.proofToken as string;

    const secretResponse = responseDouble();
    const redemption = await controller.accessCode("course-1", "23455", proofToken, requestDouble(), secretResponse);
    expect(redemption).toEqual(
      expect.objectContaining({
        success: true,
        accessCode: "ACCESS-CODE",
        exitGrant: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        exitGrantExpiresInSeconds: 43_200,
        tools: []
      })
    );
    expect(secretResponse.setHeader).toHaveBeenCalledWith("cache-control", "private, no-store, max-age=0");
    expect(secretResponse.vary).toHaveBeenCalledWith("Origin, X-SEB-Proof-Token");
    await expect(controller.accessCode("course-1", "23455", proofToken, requestDouble())).rejects.toMatchObject({
      status: 403
    });

    const exitGrant = redemption.exitGrant as string;
    const exitResponse = responseDouble();
    await controller.exitSessionPage(
      requestDouble(`/seb/exit/session/course-1/23455/${exitGrant}`),
      exitResponse,
      "course-1",
      "23455",
      exitGrant
    );
    expect(exitResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-exit"'));
    expect(exitResponse.send).toHaveBeenCalledWith(
      expect.stringContaining(`/seb/exit/quit/course-1/23455/${exitGrant}`)
    );

    const quitResponse = responseDouble();
    await controller.quitWithGrant(quitResponse, "course-1", "23455", exitGrant);
    const configuredQuitUrl = quitResponse.redirect.mock.calls[0][1] as string;
    expect(quitResponse.redirect).toHaveBeenCalledWith(
      303,
      expect.stringMatching(
        /^https:\/\/tool\.example\.edu\/seb\/exit\/complete\/course-1\/classicquiz_23455\/[A-Za-z0-9_-]{43}$/u
      )
    );

    const completeResponse = responseDouble();
    await controller.completeQuit(
      requestDouble(new URL(configuredQuitUrl).pathname),
      completeResponse,
      "course-1",
      "classicquiz_23455",
      configuredQuitUrl.split("/").at(-1)!
    );
    expect(completeResponse.setHeader).toHaveBeenCalledWith("x-seb-quit", "true");
    expect(completeResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-quit"'));
  });

  it("does not mint a proof from a stale setting after the Canvas assessment object is gone", async () => {
    const { controller } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          quizId: "23455",
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          accessCode: "STALE-ACCESS",
          ssoDomains: [],
          educationalToolDomains: [],
          urlRules: [],
          externalTools: []
        })
      }
    });
    const quizUrl = "https://canvas.example.edu/courses/course-1/quizzes/23455/take";
    const configKeyService = new SebConfigKeyService();
    const currentConfigKey = configKeyService.computeConfigKey(
      new SebConfigurationService(configDouble() as any).generateSebConfiguration({
        courseId: "course-1",
        contentId: "classicquiz_23455",
        startUrl: quizUrl,
        accessCode: "STALE-ACCESS",
        allowedDomains: []
      })
    );

    await expect(
      controller.createAccessProof(requestDouble(), "course-1", "23455", {
        configKeyHash: configKeyService.hashForUrl(quizUrl, currentConfigKey),
        url: quizUrl
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("mints the one-time config grant only on a same-origin authenticated click", async () => {
    const { controller, configGrants } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          quizId: "23455",
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          accessCode: "ACCESS",
          urlRules: [],
          externalTools: []
        }),
        getQuiz: vi.fn().mockResolvedValue({ id: "23455", courseId: "course-1", title: "Midterm" })
      }
    });
    const token = createSebConfigGrantActionToken(configDouble() as any, "student-1", "course-1", {
      subject: "opaque-student-1",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    await expect(
      controller.issueConfigGrant(
        requestDouble("/api/seb/config-grant/course-1/classicquiz_23455", token),
        "course-1",
        "classicquiz_23455"
      )
    ).resolves.toMatchObject({
      success: true,
      sebLaunchUrl: expect.stringMatching(
        /^sebs:\/\/tool\.example\.edu\/seb\/config\/course-1\/classicquiz_23455\.seb\?grant=/u
      ),
      expiresInSeconds: 120
    });
    expect(configGrants.mintGrant).toHaveBeenCalledTimes(1);

    await expect(
      controller.issueConfigGrant(
        requestDouble("/api/seb/config-grant/course-1/classicquiz_23455"),
        "course-1",
        "classicquiz_23455"
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not mint a student config grant without the mandatory Canvas session connection", async () => {
    const { controller, canvasApi, configGrants } = controllerWith({
      canvasApi: { hasSessionTokenAccess: vi.fn().mockResolvedValue(false) }
    });
    const token = createSebConfigGrantActionToken(configDouble() as any, "student-1", "course-1", {
      subject: "opaque-student-1",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    await expect(
      controller.issueConfigGrant(
        requestDouble("/api/seb/config-grant/course-1/classicquiz_23455", token),
        "course-1",
        "classicquiz_23455"
      )
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ error_code: "CANVAS_SESSION_AUTHORIZATION_REQUIRED" })
    });
    expect(canvasApi.hasSessionTokenAccess).toHaveBeenCalledWith("student-1");
    expect(configGrants.mintGrant).not.toHaveBeenCalled();
  });

  it("uses the same scoped Canvas session request in the student readiness check", async () => {
    const { controller, canvasApi } = controllerWith();
    const token = createSebConfigGrantActionToken(configDouble() as any, "student-1", "course-1", {
      subject: "opaque-student-1",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    await expect(
      controller.verifyStudentSessionReadiness(requestDouble("/api/seb/session-readiness", token))
    ).resolves.toEqual({ success: true, checks: { canvasSessionAuthorization: true } });
    expect(canvasApi.getSessionToken).toHaveBeenCalledWith("student-1", "https://canvas.example.edu/courses/course-1");
  });

  it("persists only a student's setup-check reminder dismissal", async () => {
    const { controller, canvasApi } = controllerWith();
    const token = createSebConfigGrantActionToken(configDouble() as any, "student-1", "course-1", {
      subject: "opaque-student-1",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    await expect(
      controller.dismissStudentReadinessPrompt(requestDouble("/api/seb/session-readiness/dismiss", token))
    ).resolves.toEqual({ success: true });
    expect(canvasApi.dismissStudentReadinessPrompt).toHaveBeenCalledWith("student-1");
  });

  it("does not mint a learner config grant for stale or missing cached Canvas state", async () => {
    const { controller, configGrants } = controllerWith({
      assessments: {
        isAssessmentAvailableForLearner: vi.fn().mockResolvedValue(false),
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          quizId: "23455",
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          accessCode: "STALE-ACCESS",
          urlRules: [],
          externalTools: []
        }),
        getQuiz: vi.fn().mockResolvedValue({ id: "23455", courseId: "course-1", title: "Stale Midterm" })
      }
    });
    const token = createSebConfigGrantActionToken(configDouble() as any, "student-1", "course-1", {
      subject: "opaque-student-1",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    await expect(
      controller.issueConfigGrant(
        requestDouble("/api/seb/config-grant/course-1/classicquiz_23455", token),
        "course-1",
        "classicquiz_23455"
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(configGrants.mintGrant).not.toHaveBeenCalled();
  });

  it("keeps public exit and quit endpoints nonterminal", async () => {
    const { controller } = controllerWith();
    const exitResponse = responseDouble();

    await controller.exitPage(
      requestDouble("/seb/exit/course-1/classicquiz_23455"),
      exitResponse,
      "course-1",
      "classicquiz_23455"
    );
    expect(exitResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-exit"'));
    expect(exitResponse.send).toHaveBeenCalledWith(expect.stringContaining('"quitUrl":null'));
    expect(exitResponse.send).toHaveBeenCalledWith(expect.stringContaining('"manualQuitUrl":null'));

    const quitResponse = responseDouble();
    controller.quit(quitResponse, "course-1", "23455");
    expect(quitResponse.status).toHaveBeenCalledWith(410);
    expect(quitResponse.setHeader).not.toHaveBeenCalledWith("x-seb-quit", "true");
    expect(quitResponse.setHeader).not.toHaveBeenCalledWith("x-seb-exit", expect.anything());
    expect(quitResponse.send).toHaveBeenCalledWith(expect.stringContaining("Automatic quit is unavailable"));
  });

  it("serves configured SEB encryption certificates and 404s when absent", () => {
    const certificate = {
      pem: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
      der: Buffer.from("DER"),
      publicKeyHash: Buffer.from("hash")
    };
    const { controller } = controllerWith({
      sebConfig: {
        getEncryptionCertificate: vi.fn().mockReturnValue(certificate)
      }
    });
    const pemResponse = responseDouble();
    controller.downloadConfigEncryptionCertificatePem(pemResponse);
    expect(pemResponse.status).toHaveBeenCalledWith(200);
    expect(pemResponse.type).toHaveBeenCalledWith("application/x-pem-file");
    expect(pemResponse.setHeader).toHaveBeenCalledWith(
      "x-seb-public-key-hash",
      certificate.publicKeyHash.toString("hex")
    );
    expect(pemResponse.send).toHaveBeenCalledWith(certificate.pem);

    const derResponse = responseDouble();
    controller.downloadConfigEncryptionCertificateDer(derResponse);
    expect(derResponse.type).toHaveBeenCalledWith("application/pkix-cert");
    expect(derResponse.send).toHaveBeenCalledWith(certificate.der);

    const missing = controllerWith({
      sebConfig: { getEncryptionCertificate: vi.fn().mockReturnValue(null) }
    }).controller;
    const missingResponse = responseDouble();
    missing.downloadConfigEncryptionCertificatePem(missingResponse);
    expect(missingResponse.status).toHaveBeenCalledWith(404);
  });

  it("accepts Windows HEAD probes without consuming the GET grant path", async () => {
    const { controller, configGrants } = controllerWith();
    configGrants.validateGrant = vi.fn().mockResolvedValue(true);
    const response = responseDouble();

    await controller.downloadConfig(
      { method: "HEAD" } as any,
      response,
      "course-1",
      "classicquiz_23455",
      "g".repeat(43)
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(configGrants.validateGrant).toHaveBeenCalledWith("g".repeat(43), "course-1", "classicquiz_23455");
    expect(configGrants.consumeGrant).not.toHaveBeenCalled();
  });

  it("caches the stable protected setup-check download across repeated allowed requests", async () => {
    const download = Buffer.from("downloaded-seb-config");
    const sebConfig = {
      getEncryptionCertificate: vi.fn().mockReturnValue(null),
      generateSebSetupCheckConfiguration: vi.fn().mockReturnValue(Buffer.from("plain-seb-config")),
      prepareSebConfigurationDownload: vi.fn().mockReturnValue(download),
      assertConfigurationDownloadReady: vi.fn()
    };
    const { controller } = controllerWith({ sebConfig });
    const pageResponse = responseDouble();

    controller.setupCheckPage(requestDouble("/seb/check"), pageResponse);

    expect(pageResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-check"'));
    expect(pageResponse.send).toHaveBeenCalledWith(expect.stringContaining("/api/seb/check-proof"));

    const configResponse = responseDouble();
    await controller.downloadSetupCheckConfig(requestDouble("/seb/check/config.seb"), configResponse);
    const secondConfigResponse = responseDouble();
    await controller.downloadSetupCheckConfig(requestDouble("/seb/check/config.seb"), secondConfigResponse);

    expect(sebConfig.generateSebSetupCheckConfiguration).toHaveBeenCalledTimes(1);
    expect(sebConfig.generateSebSetupCheckConfiguration).toHaveBeenCalledWith({
      startUrl: "https://tool.example.edu/seb/check",
      quitUrl: "https://tool.example.edu/seb/check/quit"
    });
    expect(sebConfig.prepareSebConfigurationDownload).toHaveBeenCalledTimes(1);
    expect(sebConfig.prepareSebConfigurationDownload).toHaveBeenCalledWith(Buffer.from("plain-seb-config"));
    expect(sebConfig.assertConfigurationDownloadReady).toHaveBeenCalledTimes(2);
    expect(configResponse.status).toHaveBeenCalledWith(200);
    expect(configResponse.type).toHaveBeenCalledWith("application/octet-stream");
    expect(configResponse.setHeader).toHaveBeenCalledWith(
      "content-disposition",
      'attachment; filename="seb-setup-check.seb"'
    );
    expect(configResponse.send).toHaveBeenCalledWith(download);
    expect(secondConfigResponse.send).toHaveBeenCalledWith(download);
  });

  it("rechecks encryption readiness before serving cached setup-check bytes", async () => {
    const download = Buffer.from("downloaded-seb-config");
    const sebConfig = {
      generateSebSetupCheckConfiguration: vi.fn().mockReturnValue(Buffer.from("plain-seb-config")),
      prepareSebConfigurationDownload: vi.fn().mockReturnValue(download),
      assertConfigurationDownloadReady: vi
        .fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw new Error("SEB config encryption certificate has expired");
        })
    };
    const { controller } = controllerWith({ sebConfig });

    const firstResponse = responseDouble();
    await controller.downloadSetupCheckConfig(requestDouble("/seb/check/config.seb"), firstResponse);
    const secondResponse = responseDouble();
    await controller.downloadSetupCheckConfig(requestDouble("/seb/check/config.seb"), secondResponse);

    expect(firstResponse.status).toHaveBeenCalledWith(200);
    expect(firstResponse.send).toHaveBeenCalledWith(download);
    expect(secondResponse.status).toHaveBeenCalledWith(400);
    expect(secondResponse.send).toHaveBeenCalledWith("Unable to generate the SEB setup check configuration.");
    expect(sebConfig.prepareSebConfigurationDownload).toHaveBeenCalledTimes(1);
    expect(sebConfig.assertConfigurationDownloadReady).toHaveBeenCalledTimes(2);
  });

  it("verifies setup-check Config Key proof for the generated check URL", () => {
    const { controller } = controllerWith();
    const configKeyService = new SebConfigKeyService();
    const configKey = configKeyService.computeConfigKey(
      new SebConfigurationService(configDouble() as any).generateSebSetupCheckConfiguration({
        startUrl: "https://tool.example.edu/seb/check",
        quitUrl: "https://tool.example.edu/seb/check/quit"
      })
    );

    expect(
      controller.verifySetupCheck(requestDouble("/api/seb/check-proof"), {
        configKeyHash: configKeyService.hashForUrl("https://tool.example.edu/seb/check", configKey),
        url: "https://tool.example.edu/seb/check"
      })
    ).toEqual({
      success: true,
      checks: {
        configKey: true,
        expectedUrl: true
      }
    });

    expect(() =>
      controller.verifySetupCheck(requestDouble("/api/seb/check-proof"), {
        configKeyHash: configKey,
        url: "https://tool.example.edu/seb/check"
      })
    ).toThrowError(/setup check configuration could not be verified/u);

    expect(() =>
      controller.verifySetupCheck(requestDouble("/api/seb/check-proof"), {
        configKeyHash: "bad",
        url: "https://tool.example.edu/seb/check"
      })
    ).toThrowError(/setup check configuration could not be verified/u);
  });

  it("applies distributed admission before generating the public setup-check config", async () => {
    const sebConfig = {
      generateSebSetupCheckConfiguration: vi.fn(),
      prepareSebConfigurationDownload: vi.fn()
    };
    const { controller } = controllerWith({
      sebConfig,
      distributedAdmission: { consumeRequestIp: vi.fn().mockResolvedValue(false) }
    });
    const response = responseDouble();

    await controller.downloadSetupCheckConfig(requestDouble("/seb/check/config.seb"), response);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(sebConfig.generateSebSetupCheckConfiguration).not.toHaveBeenCalled();
  });

  it("serves setup-check quit headers", () => {
    const { controller } = controllerWith();
    const response = responseDouble();

    controller.quitSetupCheck(requestDouble("/seb/check/quit"), response);

    expect(response.setHeader).toHaveBeenCalledWith("x-seb-quit", "true");
    expect(response.setHeader).toHaveBeenCalledWith("x-seb-exit", "setup-check");
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-quit"'));
  });

  it("requires a Canvas launch session before serving SEB launch pages", async () => {
    const response = responseDouble();
    const { controller } = controllerWith();

    await controller.launchGet({ session: null } as any, response, "classicquiz_23455");

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Canvas Launch Required"));
  });

  it.each([
    ["missing", {}],
    ["mismatched", { [BROWSER_TRANSACTION.cookieName]: "x".repeat(43) }]
  ])(
    "rejects a %s initiating-browser cookie before validating an LTI POST to an assessment launch",
    async (_label, cookies) => {
      const { controller, ltiService, ltiState, distributedAdmission } = controllerWith();
      const response = responseDouble();
      const request = oidcRequestDouble(cookies);

      await controller.launchPost(request, response, "classicquiz_23455", {
        id_token: "signed-token",
        state: "copied-state"
      });

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Please launch this assessment from Canvas"));
      expect(distributedAdmission.consumeLtiStateValidationAttempt).not.toHaveBeenCalled();
      expect(ltiService.validateToken).not.toHaveBeenCalled();
      expect(ltiState.claimState).not.toHaveBeenCalled();
      expect(request.session.regenerate).not.toHaveBeenCalled();
      expect(request.session.verifiedLtiPrincipal).toBeUndefined();
      expect(response.clearCookie).not.toHaveBeenCalled();
    }
  );

  it("returns a stale or replayed assessment launch to its Canvas course", async () => {
    const { controller, ltiService } = controllerWith({
      assessments: {
        getQuiz: vi.fn().mockResolvedValue({
          id: "23455",
          courseId: "course-1",
          title: "Midterm",
          htmlUrl: "https://canvas.example.edu/courses/course-1/quizzes/23455"
        }),
        getSebSettingForQuiz: vi.fn().mockResolvedValue({ courseId: "course-1", sebRequired: true })
      }
    });
    const response = responseDouble();
    const request = oidcRequestDouble({});

    await controller.launchPost(request, response, "classicquiz_23455", {
      id_token: "stale-signed-token",
      state: "stale-state"
    });

    expect(ltiService.validateToken).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(303, "https://canvas.example.edu/courses/course-1");
    expect(response.status).not.toHaveBeenCalledWith(400);
  });

  it("accepts and clears a valid browser-bound LTI POST to an assessment launch", async () => {
    const { controller, ltiService, ltiState } = controllerWith({
      assessments: {
        getQuiz: vi.fn().mockResolvedValue({
          id: "23455",
          courseId: "course-1",
          title: "Midterm",
          htmlUrl: "https://canvas.example.edu/courses/course-1/quizzes/23455"
        }),
        getSebSettingForQuiz: vi.fn().mockResolvedValue({ courseId: "course-1", sebRequired: false })
      }
    });
    const response = responseDouble();
    const request = oidcRequestDouble();

    await controller.launchPost(request, response, "classicquiz_23455", {
      id_token: "signed-token",
      state: "state"
    });

    expect(ltiService.validateToken).toHaveBeenCalledWith("signed-token", "nonce-1");
    expect(ltiState.claimState).toHaveBeenCalledWith("state");
    expect(response.clearCookie).toHaveBeenCalledWith(BROWSER_TRANSACTION.cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });
    expect(request.session.regenerate).toHaveBeenCalled();
    expect(request.session.verifiedLtiPrincipal).toMatchObject({
      canvasUserId: "43",
      courseId: "course-1"
    });
    expect(response.redirect).toHaveBeenCalledWith("https://canvas.example.edu/courses/course-1/quizzes/23455/take");
  });

  it("consumes a signed one-time handoff and returns a replayed direct LTI launch to its Canvas course", async () => {
    const setting = {
      quizId: "23455",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      urlRules: [],
      externalTools: []
    };
    const { controller, configGrants } = controllerWith({
      assessments: {
        getQuiz: vi.fn().mockResolvedValue({
          id: "23455",
          courseId: "course-1",
          title: "Midterm",
          htmlUrl: "https://canvas.example.edu/courses/course-1/quizzes/23455"
        }),
        getSebSettingForQuiz: vi.fn().mockResolvedValue(setting)
      }
    });
    const request = requestDouble("/seb/launch/classicquiz_23455");
    request.session.launchData.targetLinkUri = "https://tool.example.edu/seb/launch/classicquiz_23455";
    request.session.pendingSebLaunch = {
      courseId: "course-1",
      contentId: "classicquiz_23455",
      subject: "opaque-student-1",
      deploymentId: "deployment-1",
      issuedAt: Date.now()
    };
    request.session.save = vi.fn((callback: (error?: Error) => void) => callback());
    const response = responseDouble();

    await controller.launchGet(request, response, "classicquiz_23455");

    expect(request.session.pendingSebLaunch).toBeUndefined();
    expect(configGrants.mintGrant).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ subject: "opaque-student-1", courseId: "course-1" }),
      "course-1",
      "classicquiz_23455",
      expect.any(String)
    );
    expect(response.setHeader).toHaveBeenCalledWith("cache-control", "private, no-store");
    expect(response.redirect).not.toHaveBeenCalled();
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-launching"'));
    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining(
        `sebs://tool.example.edu/seb/config/course-1/classicquiz_23455.seb?grant=${"g".repeat(43)}`
      )
    );
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("https://canvas.example.edu/courses/course-1"));

    const replayResponse = responseDouble();
    await controller.launchGet(request, replayResponse, "classicquiz_23455");
    expect(configGrants.mintGrant).toHaveBeenCalledTimes(1);
    expect(replayResponse.redirect).toHaveBeenCalledWith(303, "https://canvas.example.edu/courses/course-1");
    expect(replayResponse.send).not.toHaveBeenCalled();
  });

  it("keeps the course-navigation compatibility launch page available", async () => {
    const setting = {
      quizId: "23455",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      urlRules: [],
      externalTools: []
    };
    const { controller } = controllerWith({
      assessments: {
        getQuiz: vi.fn().mockResolvedValue({ id: "23455", courseId: "course-1", title: "Midterm" }),
        getSebSettingForQuiz: vi.fn().mockResolvedValue(setting)
      }
    });
    const request = requestDouble("/seb/launch/classicquiz_23455");
    const response = responseDouble();

    await controller.launchGet(request, response, "classicquiz_23455");

    expect(response.redirect).not.toHaveBeenCalled();
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-download"'));
  });

  it("returns a connected student to the assessment download screen without minting a configuration", async () => {
    const setting = {
      quizId: "23455",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      urlRules: [],
      externalTools: []
    };
    const { controller, configGrants } = controllerWith({
      assessments: {
        getQuiz: vi.fn().mockResolvedValue({ id: "23455", courseId: "course-1", title: "Midterm" }),
        getSebSettingForQuiz: vi.fn().mockResolvedValue(setting)
      }
    });
    const request = requestDouble("/seb/launch/classicquiz_23455?connected=1");
    request.session.launchData.targetLinkUri = "https://tool.example.edu/seb/launch/classicquiz_23455";
    const response = responseDouble();

    await controller.launchGet(request, response, "classicquiz_23455", "1");

    expect(configGrants.mintGrant).not.toHaveBeenCalled();
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-download"'));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"showReadinessPrompt":true'));
  });

  it("keeps compatibility GETs non-mutating and rejects cross-site navigation", async () => {
    const { controller, configGrants, assessments } = controllerWith({
      assessments: {
        getQuiz: vi.fn().mockResolvedValue({ id: "23455", courseId: "course-1", title: "Midterm" })
      }
    });
    const response = responseDouble();

    await controller.redirectConfig(requestDouble("/seb/config/course-1/23455"), response, "course-1", "23455");

    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining("/api/seb/config-grant/course-1/classicquiz_23455")
    );
    expect(configGrants.mintGrant).not.toHaveBeenCalled();

    const crossSite = requestDouble("/seb/config/course-1/23455");
    crossSite.header = (name: string) => (name.toLowerCase() === "sec-fetch-site" ? "cross-site" : undefined);
    const crossSiteResponse = responseDouble();
    await controller.redirectConfig(crossSite, crossSiteResponse, "course-1", "23455");
    expect(crossSiteResponse.status).toHaveBeenCalledWith(403);
    expect(configGrants.mintGrant).not.toHaveBeenCalled();

    const anonymousResponse = responseDouble();
    await controller.legacyConfigRedirect(
      { session: null, header: () => undefined } as any,
      anonymousResponse,
      "23455"
    );
    expect(anonymousResponse.status).toHaveBeenCalledWith(403);
    expect(assessments.getQuiz).toHaveBeenCalledTimes(0);
  });
});

function controllerWith(options: Record<string, any> = {}) {
  const proofService =
    options.proofService || new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);
  const assessments = {
    isAssessmentAvailableForLearner: vi.fn().mockResolvedValue(true),
    getSebSettingForQuiz: vi.fn().mockResolvedValue(null),
    getContentSebSetting: vi.fn().mockResolvedValue(null),
    getContentItem: vi.fn().mockResolvedValue(null),
    getQuiz: vi.fn().mockResolvedValue(null),
    saveQuizSebSetting: vi.fn(),
    saveContentSebSetting: vi.fn(),
    saveQuizConfigKeyIfUnchanged: vi.fn(),
    saveContentConfigKeyIfUnchanged: vi.fn(),
    ensureQuizConfigKeySaltIfUnchanged: vi.fn(),
    ensureContentConfigKeySaltIfUnchanged: vi.fn(),
    ...options.assessments
  };
  const sebDetector = {
    isRequestFromSeb: vi.fn().mockReturnValue(false),
    ...options.sebDetector
  };
  const sebConfig = options.sebConfig || new SebConfigurationService(configDouble() as any);
  const configGrants = {
    mintGrant: vi.fn().mockResolvedValue("g".repeat(43)),
    consumeGrant: vi.fn(),
    validateGrant: vi.fn().mockResolvedValue(false),
    getTokenTtlSeconds: vi.fn().mockReturnValue(120),
    ...options.configGrants
  };
  const distributedAdmission = {
    consumeRequestIp: vi.fn().mockResolvedValue(true),
    consumeLtiValidationIp: vi.fn().mockResolvedValue(true),
    consumeLtiStateValidationAttempt: vi.fn().mockResolvedValue(true),
    ...options.distributedAdmission
  };
  const canvasApi = {
    hasAccessToken: vi.fn().mockResolvedValue(true),
    hasSessionTokenAccess: vi.fn().mockResolvedValue(true),
    hasDismissedStudentReadinessPrompt: vi.fn().mockResolvedValue(false),
    dismissStudentReadinessPrompt: vi.fn().mockResolvedValue(undefined),
    getSessionToken: vi.fn().mockResolvedValue("https://canvas.example.edu/login/session_token?opaque=secret"),
    ...options.canvasApi
  };
  const ltiService = {
    validateToken: vi.fn().mockResolvedValue({
      ltiSubject: "opaque-student-1",
      canvasUserId: "43",
      issuer: "https://canvas.example.edu",
      userId: "43",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      deploymentId: "deployment-1",
      targetLinkUri: "https://tool.example.edu/seb/launch/classicquiz_23455",
      messageType: "LtiResourceLinkRequest"
    }),
    ...options.ltiService
  };
  const ltiState = {
    peekState: vi.fn().mockReturnValue({
      nonce: "nonce-1",
      issuer: "https://canvas.example.edu",
      deploymentId: "deployment-1",
      targetLinkUri: "https://tool.example.edu/seb/launch/classicquiz_23455",
      [LTI_OIDC_TRANSACTION_ID_FIELD]: BROWSER_TRANSACTION.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: BROWSER_TRANSACTION.bindingHash
    }),
    claimState: vi.fn().mockResolvedValue(undefined),
    ...options.ltiState
  };
  const controller = new SebController(
    configDouble() as any,
    ltiService as any,
    ltiState as any,
    assessments as any,
    sebDetector as any,
    sebConfig as any,
    new SebConfigKeyService(),
    proofService,
    configGrants as any,
    distributedAdmission as any,
    canvasApi as any
  );
  return { controller, assessments, sebDetector, configGrants, ltiService, ltiState, distributedAdmission, canvasApi };
}

function configDouble() {
  return {
    getApplicationBaseUrl: () => "https://tool.example.edu",
    getCanvasDomain: () => "https://canvas.example.edu",
    toolUrl: "https://tool.example.edu",
    getRequiredToolUrl: () => "https://tool.example.edu",
    value: {
      security: { sessionSecret: "test-session-secret" },
      seb: {
        defaultQuitPassword: "managed-server-exit",
        requiredDomains: [],
        configEncryption: {
          enabled: false
        }
      }
    }
  };
}

function requestDouble(path = "/seb/quiz/course-1/23455", authToken?: string): any {
  const principal = {
    version: 1,
    issuer: "https://canvas.example.edu",
    deploymentId: "deployment-1",
    subject: "opaque-student-1",
    canvasUserId: "student-1",
    courseId: "course-1",
    roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
    custom: {},
    authenticatedAt: "2026-01-01T00:00:00.000Z"
  };
  return {
    path,
    protocol: "https",
    hostname: "tool.example.edu",
    originalUrl: path,
    sessionID: "session-1",
    session: { verifiedLtiPrincipal: principal, launchData: { courseId: "course-1" } },
    ip: "192.0.2.10",
    get: (name: string) => (name.toLowerCase() === "host" ? "tool.example.edu" : undefined),
    header: (name: string) =>
      ({
        "x-auth-token": authToken,
        origin: "https://tool.example.edu",
        referer: "https://tool.example.edu/lti/launch",
        "sec-fetch-site": "same-origin"
      })[name.toLowerCase()]
  };
}

function oidcRequestDouble(
  cookies: Record<string, string> = { [BROWSER_TRANSACTION.cookieName]: BROWSER_TRANSACTION.cookieValue }
): any {
  const session = {
    regenerate: vi.fn((callback: (error?: Error) => void) => callback())
  };
  return {
    path: "/seb/launch/classicquiz_23455",
    originalUrl: "/seb/launch/classicquiz_23455",
    protocol: "https",
    hostname: "tool.example.edu",
    sessionID: "new-session-1",
    session,
    cookies,
    ip: "192.0.2.11",
    get: (name: string) => (name.toLowerCase() === "host" ? "tool.example.edu" : undefined),
    header: () => undefined
  };
}

function responseDouble(): any {
  const response = {
    redirect: vi.fn(),
    send: vi.fn(),
    status: vi.fn(),
    type: vi.fn(),
    setHeader: vi.fn(),
    vary: vi.fn(),
    clearCookie: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.setHeader.mockReturnValue(response);
  return response;
}
