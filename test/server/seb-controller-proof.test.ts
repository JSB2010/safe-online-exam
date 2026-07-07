import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

const CANVAS_URL = "https://kentdenver.instructure.com";
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

  it("accepts a direct Config Key value exposed by the SEB JavaScript API", async () => {
    await withConfig(async () => {
      const storedConfigKey = classicConfigKey();
      const { controller, proofService } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: storedConfigKey
      });

      const result = await controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
        configKeyHash: storedConfigKey,
        url: `${CANVAS_URL}/courses/11825/quizzes/23455/take?user_id=7288`
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          proofToken: expect.any(String)
        })
      );
      expect(proofService.consumeProof(result.proofToken as string, "11825", "23455")).toBe(true);
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
      const hash = configKey.hashForUrl(`${CANVAS_URL}/courses/11825/assignments/991/take`, storedConfigKey);

      const result = await controller.createAccessProof(requestWithHeaders(), "11825", contentId, {
        configKeyHash: hash,
        url: `${CANVAS_URL}/courses/11825/assignments/991/take?user_id=7288`
      });

      expect(result).toEqual(expect.objectContaining({ success: true, proofToken: expect.any(String) }));
    });
  });

  it("requires a fresh config download after stored Config Key invalidation", async () => {
    await withConfig(async () => {
      const { controller } = controllerWithSetting({
        quizId: "23455",
        courseId: "11825",
        configKey: null
      });

      await expectApiError(
        controller.createAccessProof(requestWithHeaders(), "11825", "23455", {
          configKeyHash: "c".repeat(64),
          url: `${CANVAS_URL}/courses/11825/quizzes/23455/take`
        }),
        409
      );
    });
  });

  it("rejects stale Config Keys after generated SEB settings change", async () => {
    await withConfig(async () => {
      const configKey = new SebConfigKeyService();
      const staleConfigKey = configKey.computeConfigKey(
        Buffer.from(
          "<plist><dict><key>startURL</key><string>https://kentdenver.instructure.com/courses/11825/quizzes/23455</string></dict></plist>"
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
});

async function withConfig(run: () => Promise<void>): Promise<void> {
  const previousCanvasBaseUrl = process.env.CANVAS_BASE_URL;
  const previousToolUrl = process.env.TOOL_URL;
  process.env.CANVAS_BASE_URL = CANVAS_URL;
  process.env.TOOL_URL = TOOL_URL;
  try {
    await run();
  } finally {
    restoreEnv("CANVAS_BASE_URL", previousCanvasBaseUrl);
    restoreEnv("TOOL_URL", previousToolUrl);
  }
}

function controllerWithSetting(setting: Record<string, unknown>) {
  const proofService = new SebAccessProofService();
  const resolvedSetting = {
    sebRequired: true,
    enabled: true,
    accessCode: "ACCESS-CODE",
    ...setting
  };
  const controller = new SebController(
    new AppConfig(),
    {} as any,
    {} as any,
    {
      getSebSettingForQuiz: async () => resolvedSetting,
      getQuiz: async () => ({
        id: setting.quizId || "23455",
        courseId: setting.courseId || "11825",
        htmlUrl: `${CANVAS_URL}/courses/${setting.courseId || "11825"}/quizzes/${setting.quizId || "23455"}`
      })
    } as any,
    {
      getSebSetting: async () => resolvedSetting,
      getContentItem: async () => null
    } as any,
    {} as any,
    {} as any,
    new SebConfigurationService(new AppConfig()),
    new SebConfigKeyService(),
    proofService
  );
  return { controller, proofService };
}

function classicConfigKey(courseId = "11825", quizId = "23455", accessCode = "ACCESS-CODE"): string {
  const config = new AppConfig();
  const generated = new SebConfigurationService(config).generateSebConfiguration({
    courseId,
    contentId: `classicquiz_${quizId}`,
    startUrl: `${CANVAS_URL}/courses/${courseId}/quizzes/${quizId}/take`,
    accessCode,
    allowedDomains: [],
    quitPassword: null
  });
  return new SebConfigKeyService().computeConfigKey(generated);
}

function newQuizConfigKey(contentId: string, courseId = "11825", accessCode = "ACCESS-CODE"): string {
  const assignmentId = contentId.split(":")[2];
  const generated = new SebConfigurationService(new AppConfig()).generateSebConfiguration({
    courseId,
    contentId,
    startUrl: `${CANVAS_URL}/courses/${courseId}/assignments/${assignmentId}/take`,
    accessCode,
    allowedDomains: [],
    quitPassword: null
  });
  return new SebConfigKeyService().computeConfigKey(generated);
}

function requestWithHeaders(headers: Record<string, string> = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
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
