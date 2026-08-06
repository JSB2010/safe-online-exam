import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

const CANVAS_URL = "https://canvas.example.edu";
const TOOL_URL = "https://tool.example.edu";

describe("SEB access proof validation", () => {
  it("rejects arbitrary SEB-looking JavaScript Config Key values", async () => {
    await withConfig(async () => {
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: classicConfigKey()
      });

      await expectApiError(
        controller.createAccessProof(requestWithHeaders({ "user-agent": "Mozilla/5.0 SEB/3.6.1" }), "11825", "23455", {
          configKeyHash: "a".repeat(64),
          url: `${CANVAS_URL}/courses/11825/quizzes/23455/take?user_id=7288`
        }),
        403
      );
    });
  });

  it("does not reveal an access code from spoofed SEB headers without a minted one-time proof", async () => {
    await withConfig(async () => {
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: classicConfigKey()
      });
      const spoofedSebRequest = requestWithHeaders({
        "user-agent": "Mozilla/5.0 SafeExamBrowser/3.6.1",
        "x-safeexambrowser-configkeyhash": "a".repeat(64),
        "x-safeexambrowser-requesthash": "b".repeat(64)
      });

      await expectApiError(controller.accessCode("11825", "23455", undefined, spoofedSebRequest), 403);
      await expectApiError(controller.accessCode("11825", "23455", "x".repeat(43), spoofedSebRequest), 403);
    });
  });

  it("rejects a raw Config Key because proof must be bound to the claimed URL", async () => {
    await withConfig(async () => {
      const storedConfigKey = classicConfigKey();
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: storedConfigKey
      });

      await expectApiError(
        controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
          configKeyHash: storedConfigKey,
          url: `${CANVAS_URL}/courses/11825/quizzes/23455/take?user_id=7288`
        }),
        403
      );
    });
  });

  it("accepts a URL-bound Config Key hash for the expected Canvas quiz URL", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const storedConfigKey = classicConfigKey();
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: storedConfigKey
      });
      const hash = configKey.hashForUrl(`${CANVAS_URL}/courses/11825/quizzes/23455/take`, storedConfigKey);

      const result = await controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
        configKeyHash: hash,
        url: `${CANVAS_URL}/courses/11825/quizzes/23455/take?user_id=7288`
      });

      expect(result).toEqual(expect.objectContaining({ success: true, proofToken: expect.any(String) }));
      await expect(
        controller.accessCode("11825", "23455", result.proofToken as string, requestWithHeaders())
      ).resolves.toEqual(
        expect.objectContaining({
          success: true,
          accessCode: "ACCESS-CODE",
          exitGrant: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
          tools: []
        })
      );
    });
  });

  it("revokes an access proof when reset removes the assessment during issuance", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const storedConfigKey = classicConfigKey();
      const { controller, proofService, resolvedSetting } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: storedConfigKey
      });
      const originalMintProof = proofService.mintProof.bind(proofService);
      const mintProof = vi
        .spyOn(proofService, "mintProof")
        .mockImplementation(async (courseId, contentId, generationDigest, settingsFingerprint) => {
          const token = await originalMintProof(courseId, contentId, generationDigest, settingsFingerprint);
          resolvedSetting.sebRequired = false;
          return token;
        });
      const revokeProof = vi.spyOn(proofService, "revokeProof");
      const url = `${CANVAS_URL}/courses/11825/quizzes/23455/take`;

      await expectApiError(
        controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
          configKeyHash: configKey.hashForUrl(url, storedConfigKey),
          url
        }),
        404
      );
      expect(mintProof).toHaveBeenCalledOnce();
      expect(revokeProof).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u));
    });
  });

  it("revokes an exit grant when reset removes the assessment during access-code release", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const storedConfigKey = classicConfigKey();
      const { controller, proofService, resolvedSetting } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: storedConfigKey
      });
      const url = `${CANVAS_URL}/courses/11825/quizzes/23455/take`;
      const proof = await controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
        configKeyHash: configKey.hashForUrl(url, storedConfigKey),
        url
      });
      const originalMintExitGrant = proofService.mintExitGrant.bind(proofService);
      const mintExitGrant = vi
        .spyOn(proofService, "mintExitGrant")
        .mockImplementation(async (courseId, contentId, generationDigest) => {
          const token = await originalMintExitGrant(courseId, contentId, generationDigest);
          resolvedSetting.sebRequired = false;
          return token;
        });
      const revokeExitGrant = vi.spyOn(proofService, "revokeExitGrant");

      await expectApiError(
        controller.accessCode("11825", "23455", proof.proofToken as string, requestWithHeaders()),
        404
      );
      expect(mintExitGrant).toHaveBeenCalledOnce();
      expect(revokeExitGrant).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u));
    });
  });

  it("releases only selected tools after proof and binds proof to their exact URL rules", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const selectedTool = {
        id: "desmos-graphing",
        label: "Desmos Graphing Calculator",
        url: "https://www.desmos.com/calculator",
        enabled: true,
        preset: "desmos-graphing",
        allowedRules: [{ id: "assets", match: "path" as const, value: "https://www.desmos.com/assets/build/*" }]
      };
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: classicConfigKey("11825", "23455", "ACCESS-CODE", [
          "exact:https://www.desmos.com/calculator",
          "https://www.desmos.com/assets/build/*"
        ]),
        externalTools: [
          selectedTool,
          {
            id: "desmos-scientific",
            label: "Desmos Scientific Calculator",
            url: "https://www.desmos.com/scientific",
            enabled: false,
            preset: "desmos-scientific"
          }
        ]
      });
      const url = `${CANVAS_URL}/courses/11825/quizzes/23455/take`;
      const proof = await controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
        configKeyHash: configKey.hashForUrl(
          url,
          classicConfigKey("11825", "23455", "ACCESS-CODE", [
            "exact:https://www.desmos.com/calculator",
            "https://www.desmos.com/assets/build/*"
          ])
        ),
        url
      });

      await expect(
        controller.accessCode("11825", "23455", proof.proofToken as string, requestWithHeaders())
      ).resolves.toMatchObject({
        success: true,
        tools: [{ id: "desmos-graphing", url: "https://www.desmos.com/calculator" }]
      });
    });
  });

  it("accepts a SEB Config Key header for the access-proof request URL", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const storedConfigKey = classicConfigKey();
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: storedConfigKey
      });
      const requestUrl = `${TOOL_URL}/api/seb/access-proof/11825/23455`;
      const headerHash = configKey.hashForUrl(requestUrl, storedConfigKey);

      const result = await controller.createAccessProof(
        requestWithHeaders({ "x-safeexambrowser-configkeyhash": headerHash }),
        "11825",
        "23455",
        undefined
      );

      expect(result).toEqual(expect.objectContaining({ success: true, proofToken: expect.any(String) }));
    });
  });

  it("accepts URL-bound Config Key proof for New Quiz assignment URLs", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const contentId = "newquiz:11825:991";
      const storedConfigKey = newQuizConfigKey(contentId);
      const { controller } = controllerWithSetting({
        contentId,
        courseId: "11825",
        configKey: storedConfigKey
      });
      const hash = configKey.hashForUrl(`${CANVAS_URL}/courses/11825/assignments/991/taking/31299`, storedConfigKey);

      const result = await controller.createAccessProof(requestWithHeaders(), "11825", contentId, {
        configKeyHash: hash,
        url: `${CANVAS_URL}/courses/11825/assignments/991/taking/31299`
      });

      expect(result).toEqual(expect.objectContaining({ success: true, proofToken: expect.any(String) }));
    });
  });

  it("accepts a session-handoff Config Key on Canvas's New Quiz attempt route", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const contentId = "newquiz:11825:991";
      const handoffConfigKey = "d".repeat(64);
      const attemptUrl = `${CANVAS_URL}/courses/11825/assignments/991/taking/31299`;
      const sessionHandoff = { resolveConfigKey: vi.fn().mockResolvedValue(handoffConfigKey) };
      const { controller } = controllerWithSetting(
        {
          contentId,
          courseId: "11825",
          configKey: null
        },
        sessionHandoff
      );

      await expect(
        controller.createAccessProof(requestWithHeaders(), "11825", contentId, {
          configKeyHash: configKey.hashForUrl(attemptUrl, handoffConfigKey),
          url: attemptUrl
        })
      ).resolves.toEqual(expect.objectContaining({ success: true, proofToken: expect.any(String) }));
      expect(sessionHandoff.resolveConfigKey).toHaveBeenCalledWith(
        "11825",
        contentId,
        expect.any(String),
        configKey.hashForUrl(attemptUrl, handoffConfigKey),
        attemptUrl
      );
    });
  });

  it("rejects a different New Quiz assignment whose ID only shares a prefix", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const contentId = "newquiz:11825:991";
      const storedConfigKey = newQuizConfigKey(contentId);
      const { controller } = controllerWithSetting({
        contentId,
        courseId: "11825",
        configKey: storedConfigKey
      });
      const wrongUrl = `${CANVAS_URL}/courses/11825/assignments/9910/taking/31299`;

      await expectApiError(
        controller.createAccessProof(requestWithHeaders(), "11825", contentId, {
          configKeyHash: configKey.hashForUrl(wrongUrl, storedConfigKey),
          url: wrongUrl
        }),
        403
      );
    });
  });

  it("derives the current Config Key without requiring it to be persisted", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: null
      });
      const generatedConfigKey = classicConfigKey();
      const url = `${CANVAS_URL}/courses/11825/quizzes/23455/take`;

      await expect(
        controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
          configKeyHash: configKey.hashForUrl(url, generatedConfigKey),
          url
        })
      ).resolves.toEqual(expect.objectContaining({ success: true, proofToken: expect.any(String) }));
    });
  });

  it("invalidates a minted proof when the assessment generation changes before release", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const { controller, resolvedSetting } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825"
      });
      const url = `${CANVAS_URL}/courses/11825/quizzes/23455/take`;
      const result = await controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
        configKeyHash: configKey.hashForUrl(url, classicConfigKey()),
        url
      });

      resolvedSetting.accessCode = "ROTATED-ACCESS-CODE";

      await expectApiError(
        controller.accessCode("11825", "23455", result.proofToken as string, requestWithHeaders()),
        403
      );
    });
  });

  it("rejects stale Config Keys after generated SEB settings change", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const staleConfigKey = configKey.computeConfigKey(
        Buffer.from(
          "<plist><dict><key>startURL</key><string>https://canvas.example.edu/courses/11825/quizzes/23455</string></dict></plist>"
        )
      );
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: staleConfigKey
      });
      const staleHash = configKey.hashForUrl(`${CANVAS_URL}/courses/11825/quizzes/23455/take`, staleConfigKey);

      await expectApiError(
        controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
          configKeyHash: staleHash,
          url: `${CANVAS_URL}/courses/11825/quizzes/23455/take`
        }),
        403
      );
    });
  });

  it("rejects configs generated before an exam start password was added", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const staleConfigKey = classicConfigKey();
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: staleConfigKey,
        startPassword: "unique-start-passphrase",
        configKeySalt: Buffer.alloc(32, 5).toString("base64")
      });
      const staleHash = configKey.hashForUrl(`${CANVAS_URL}/courses/11825/quizzes/23455/take`, staleConfigKey);

      await expectApiError(
        controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
          configKeyHash: staleHash,
          url: `${CANVAS_URL}/courses/11825/quizzes/23455/take`
        }),
        403
      );
    });
  });
});

async function withConfig(run: () => Promise<void>): Promise<void> {
  const previousCanvasBaseUrl = process.env.CANVAS_BASE_URL;
  const previousToolUrl = process.env.TOOL_URL;
  const previousQuitPassword = process.env.SEB_QUIT_PASSWORD;
  process.env.CANVAS_BASE_URL = CANVAS_URL;
  process.env.TOOL_URL = TOOL_URL;
  process.env.SEB_QUIT_PASSWORD = "managed-server-exit";
  try {
    await run();
  } finally {
    restoreEnv("CANVAS_BASE_URL", previousCanvasBaseUrl);
    restoreEnv("TOOL_URL", previousToolUrl);
    restoreEnv("SEB_QUIT_PASSWORD", previousQuitPassword);
  }
}

function controllerWithSetting(
  setting: Record<string, unknown>,
  sessionHandoff?: { resolveConfigKey: () => Promise<string> }
) {
  const proofService = new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);
  const resolvedSetting = {
    sebRequired: true,
    enabled: true,
    accessCode: "ACCESS-CODE",
    ...(typeof setting.contentId === "string" ? { assignmentId: setting.contentId.split(":")[2] } : {}),
    ...setting
  };
  const controller = new SebController(
    new AppConfig(),
    {} as any,
    {} as any,
    {
      isCourseResetInProgress: async () => false,
      isAssessmentAvailableForLearner: async () => true,
      getSebSettingForQuiz: async () => resolvedSetting,
      getContentSebSetting: async () => resolvedSetting,
      getContentItem: async () =>
        typeof setting.contentId === "string"
          ? {
              id: setting.contentId,
              courseId: setting.courseId || "11825",
              canvasId: setting.contentId.split(":")[2],
              assignmentId: setting.contentId.split(":")[2],
              contentType: "NEW_QUIZ",
              title: "New Quiz",
              htmlUrl: `${CANVAS_URL}/courses/${setting.courseId || "11825"}/assignments/${setting.contentId.split(":")[2]}`
            }
          : null,
      getQuiz: async () => ({
        id: setting.quizId || "23455",
        courseId: setting.courseId || "11825",
        htmlUrl: `${CANVAS_URL}/courses/${setting.courseId || "11825"}/quizzes/${setting.quizId || "23455"}`
      })
    } as any,
    {} as any,
    new SebConfigurationService(new AppConfig()),
    new SebConfigKeyService(),
    proofService,
    {} as any,
    { consumeRequestIp: async () => true } as any,
    undefined,
    sessionHandoff as any
  );
  return { controller, proofService, resolvedSetting };
}

function classicConfigKey(
  courseId = "11825",
  quizId = "23455",
  accessCode = "ACCESS-CODE",
  allowedDomains: string[] = []
): string {
  const config = new AppConfig();
  const generated = new SebConfigurationService(config).generateSebConfiguration({
    courseId,
    contentId: `classicquiz_${quizId}`,
    startUrl: `${CANVAS_URL}/courses/${courseId}/quizzes/${quizId}/take`,
    accessCode,
    allowedDomains,
    quitPassword: null
  });
  return new SebConfigKeyService().computeConfigKey(generated);
}

function newQuizConfigKey(contentId: string, courseId = "11825", accessCode = "ACCESS-CODE"): string {
  const assignmentId = contentId.split(":")[2];
  const generated = new SebConfigurationService(new AppConfig()).generateSebConfiguration({
    courseId,
    contentId,
    startUrl: `${CANVAS_URL}/courses/${courseId}/assignments/${assignmentId}`,
    accessCode,
    allowedDomains: [],
    quitPassword: null
  });
  return new SebConfigKeyService().computeConfigKey(generated);
}

function requestWithHeaders(headers: Record<string, string> = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ip: "192.0.2.25",
    socket: { remoteAddress: "192.0.2.25" },
    protocol: "https",
    hostname: "tool.example.edu",
    originalUrl: "/api/seb/access-proof/11825/23455",
    url: "/api/seb/access-proof/11825/23455",
    get(name: string) {
      return name.toLowerCase() === "host" ? "tool.example.edu" : undefined;
    },
    header(name: string) {
      return normalized[name.toLowerCase()];
    }
  } as any;
}

async function expectApiError(promise: Promise<unknown>, statusCode: number): Promise<void> {
  try {
    await promise;
    throw new Error("Expected API error");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(statusCode);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
