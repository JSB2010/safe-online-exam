import { describe, expect, it, vi } from "vitest";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

describe("SebController route contracts", () => {
  it("redirects Classic Quiz enforcement when SEB is not required", async () => {
    const response = responseDouble();
    const { controller } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({ sebRequired: false })
      }
    });

    await controller.enforceQuiz(requestDouble(), response, "course-1", "quiz-1");

    expect(response.redirect).toHaveBeenCalledWith("https://canvas.example.edu/courses/course-1/quizzes/quiz-1/take");
  });

  it("renders the SEB-required app shell when a browser opens a required Classic Quiz", async () => {
    const response = responseDouble();
    const { controller, sebDetector } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
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
      "quiz-1",
      "https://canvas.example.edu/courses/course-1/quizzes/quiz-1",
      "student-1"
    );

    const html = response.send.mock.calls[0][0] as string;
    expect(html).toContain('"view":"seb-required"');
    expect(html).toContain("/seb/config/course-1/quiz-1.seb");
    expect(html).toContain("sebs://");
  });

  it("returns only enabled external tools for SEB-required settings", async () => {
    const { controller } = controllerWith({
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          sebRequired: true,
          enabled: true,
          externalTools: [
            { id: "calc", label: "Calculator", url: "calc.example.edu", enabled: true },
            { id: "notes", label: "Notes", url: "https://notes.example.edu", enabled: false }
          ]
        })
      }
    });

    await expect(controller.tools("course-1", "quiz-1")).resolves.toEqual({
      success: true,
      tools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu/" }]
    });
  });

  it("gates access-code retrieval with one-time proof tokens", async () => {
    const proofService = new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);
    const proofToken = await proofService.mintProof("course-1", "quiz-1");
    const { controller } = controllerWith({
      proofService,
      assessments: {
        getSebSettingForQuiz: vi.fn().mockResolvedValue({
          quizId: "quiz-1",
          courseId: "course-1",
          sebRequired: true,
          enabled: true,
          accessCode: "ACCESS-CODE"
        })
      }
    });

    await expect(controller.accessCode("course-1", "quiz-1", proofToken)).resolves.toEqual({
      success: true,
      accessCode: "ACCESS-CODE"
    });
    await expect(controller.accessCode("course-1", "quiz-1", proofToken)).rejects.toMatchObject({
      status: 403
    });
  });

  it("serves SEB exit pages and quit headers for automatic and manual exits", async () => {
    const { controller } = controllerWith();
    const exitResponse = responseDouble();

    await controller.exitPage(
      requestDouble("/seb/exit/course-1/classicquiz_quiz-1"),
      exitResponse,
      "course-1",
      "classicquiz_quiz-1"
    );
    expect(exitResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-exit"'));
    expect(exitResponse.send).toHaveBeenCalledWith(expect.stringContaining("/seb/exit/quit/course-1/quiz-1"));

    const quitResponse = responseDouble();
    controller.quit(requestDouble("/seb/exit/manual/course-1/quiz-1"), quitResponse, "course-1", "quiz-1");
    expect(quitResponse.setHeader).toHaveBeenCalledWith("x-seb-quit", "true");
    expect(quitResponse.setHeader).toHaveBeenCalledWith("x-seb-exit", "manual");
    expect(quitResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-quit"'));
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

  it("serves a setup-check page and encrypted setup-check config download", () => {
    const download = Buffer.from("downloaded-seb-config");
    const sebConfig = {
      getEncryptionCertificate: vi.fn().mockReturnValue(null),
      generateSebSetupCheckConfiguration: vi.fn().mockReturnValue(Buffer.from("plain-seb-config")),
      prepareSebConfigurationDownload: vi.fn().mockReturnValue(download)
    };
    const { controller } = controllerWith({ sebConfig });
    const pageResponse = responseDouble();

    controller.setupCheckPage(requestDouble("/seb/check"), pageResponse);

    expect(pageResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-check"'));
    expect(pageResponse.send).toHaveBeenCalledWith(expect.stringContaining("/api/seb/check-proof"));

    const configResponse = responseDouble();
    controller.downloadSetupCheckConfig(configResponse);

    expect(sebConfig.generateSebSetupCheckConfiguration).toHaveBeenCalledWith({
      startUrl: "https://tool.example.edu/seb/check",
      quitUrl: "https://tool.example.edu/seb/check/quit"
    });
    expect(sebConfig.prepareSebConfigurationDownload).toHaveBeenCalledWith(Buffer.from("plain-seb-config"));
    expect(configResponse.status).toHaveBeenCalledWith(200);
    expect(configResponse.type).toHaveBeenCalledWith("application/octet-stream");
    expect(configResponse.setHeader).toHaveBeenCalledWith(
      "content-disposition",
      'attachment; filename="seb-setup-check.seb"'
    );
    expect(configResponse.send).toHaveBeenCalledWith(download);
  });

  it("verifies setup-check Config Key proof for the generated check URL", () => {
    const { controller } = controllerWith();
    const configKey = new SebConfigKeyService().computeConfigKey(
      new SebConfigurationService(configDouble() as any).generateSebSetupCheckConfiguration({
        startUrl: "https://tool.example.edu/seb/check",
        quitUrl: "https://tool.example.edu/seb/check/quit"
      })
    );

    expect(
      controller.verifySetupCheck(requestDouble("/api/seb/check-proof"), {
        configKeyHash: configKey,
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
        configKeyHash: "bad",
        url: "https://tool.example.edu/seb/check"
      })
    ).toThrowError(/setup check configuration could not be verified/u);
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

    await controller.launchGet({ session: null } as any, response, "classicquiz_quiz-1");

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Canvas Launch Required"));
  });
});

function controllerWith(options: Record<string, any> = {}) {
  const proofService =
    options.proofService || new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);
  const assessments = {
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
  const controller = new SebController(
    configDouble() as any,
    {} as any,
    {} as any,
    assessments as any,
    sebDetector as any,
    sebConfig as any,
    new SebConfigKeyService(),
    proofService
  );
  return { controller, assessments, sebDetector };
}

function configDouble() {
  return {
    getApplicationBaseUrl: () => "https://tool.example.edu",
    getCanvasDomain: () => "https://canvas.example.edu",
    toolUrl: "https://tool.example.edu",
    value: {
      seb: {
        defaultQuitPassword: null,
        requiredDomains: [],
        configEncryption: {
          enabled: false
        }
      }
    }
  };
}

function requestDouble(path = "/seb/quiz/course-1/quiz-1"): any {
  return {
    path,
    protocol: "https",
    hostname: "tool.example.edu",
    originalUrl: path,
    session: {},
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
    setHeader: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.setHeader.mockReturnValue(response);
  return response;
}
