import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import plist from "plist";
import { AppConfig } from "../../src/server/config/app-config.js";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

const CANVAS_URL = "https://kentdenver.instructure.com";
const TOOL_URL = "https://tool.example.edu";
const TEST_PUBLIC_KEY_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
  type: "pkcs1",
  format: "pem"
}) as string;

describe("SEB config downloads", () => {
  it("uses canonical Canvas quiz URLs instead of student-specific canvas_url query values", async () => {
    await withConfig(async () => {
      const saveSebSetting = vi.fn(async (setting) => setting);
      const controller = new SebController(
        new AppConfig(),
        {} as any,
        {} as any,
        {
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
          }),
          saveQuizSebSetting: saveSebSetting
        } as any,
        {} as any,
        new SebConfigurationService(new AppConfig()),
        new SebConfigKeyService(),
        new SebAccessProofService()
      );

      const generated = await downloadConfig(
        controller,
        `${CANVAS_URL}/courses/11825/quizzes/23455/take?user_id=7288&attempt=1`
      );
      const parsed = plist.parse(generated.toString("utf8")) as Record<string, unknown>;

      expect(parsed.startURL).toBe(`${CANVAS_URL}/courses/11825/quizzes/23455/take`);
      expect(parsed.restartExamURL).toBe(`${CANVAS_URL}/courses/11825/quizzes/23455/take`);
      expect(saveSebSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          configKey: new SebConfigKeyService().computeConfigKey(generated)
        })
      );
    });
  });

  it("uses canonical Canvas assignment take URLs for New Quiz configs", async () => {
    await withConfig(async () => {
      const saveSebSetting = vi.fn(async (setting) => setting);
      const controller = new SebController(
        new AppConfig(),
        {} as any,
        {} as any,
        {
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
            htmlUrl: `${CANVAS_URL}/courses/11825/assignments/991?module_item_id=44`
          }),
          saveContentSebSetting: saveSebSetting
        } as any,
        {} as any,
        new SebConfigurationService(new AppConfig()),
        new SebConfigKeyService(),
        new SebAccessProofService()
      );

      const generated = await downloadConfig(
        controller,
        `${CANVAS_URL}/courses/11825/assignments/991/take?user_id=7288`,
        "newquiz:11825:991"
      );
      const parsed = plist.parse(generated.toString("utf8")) as Record<string, unknown>;

      expect(parsed.startURL).toBe(`${CANVAS_URL}/courses/11825/assignments/991/take`);
      expect(parsed.restartExamURL).toBe(`${CANVAS_URL}/courses/11825/assignments/991/take`);
      expect(saveSebSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          configKey: new SebConfigKeyService().computeConfigKey(generated)
        })
      );
    });
  });

  it("encrypts downloaded configs while saving Config Keys from plaintext settings", async () => {
    await withConfig(
      async () => {
        const saveSebSetting = vi.fn(async (setting) => setting);
        const controller = new SebController(
          new AppConfig(),
          {} as any,
          {} as any,
          {
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
            saveQuizSebSetting: saveSebSetting
          } as any,
          {} as any,
          new SebConfigurationService(new AppConfig()),
          new SebConfigKeyService(),
          new SebAccessProofService()
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
        expect(saveSebSetting).toHaveBeenCalledWith(
          expect.objectContaining({
            configKey: new SebConfigKeyService().computeConfigKey(plaintext)
          })
        );
      },
      { encryptionEnabled: true }
    );
  });

  it("password-protects downloads while saving Config Keys from salted plaintext settings", async () => {
    await withConfig(async () => {
      const saveSebSetting = vi.fn(async (setting) => setting);
      const configKeySalt = Buffer.alloc(32, 9).toString("base64");
      const controller = new SebController(
        new AppConfig(),
        {} as any,
        {} as any,
        {
          getSebSettingForQuiz: async () => ({
            quizId: "23455",
            courseId: "11825",
            sebRequired: true,
            enabled: true,
            accessCode: "ACCESS-CODE",
            startPassword: "exam-start",
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
          saveQuizSebSetting: saveSebSetting
        } as any,
        {} as any,
        new SebConfigurationService(new AppConfig()),
        new SebConfigKeyService(),
        new SebAccessProofService()
      );

      const downloaded = await downloadConfig(controller, `${CANVAS_URL}/courses/11825/quizzes/23455/take`);
      const wrapped = gunzipSync(downloaded);
      const plaintext = new SebConfigurationService(new AppConfig()).generateSebConfiguration({
        courseId: "11825",
        contentId: "classicquiz_23455",
        startUrl: `${CANVAS_URL}/courses/11825/quizzes/23455/take`,
        accessCode: "ACCESS-CODE",
        allowedDomains: [],
        quitPassword: undefined,
        startPassword: "exam-start",
        configKeySalt
      });

      expect(wrapped.subarray(0, 4).toString("utf8")).toBe("pswd");
      expect(saveSebSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          configKey: new SebConfigKeyService().computeConfigKey(plaintext)
        })
      );
    });
  });
});

async function downloadConfig(
  controller: SebController,
  canvasUrl: string,
  contentId = "classicquiz_23455"
): Promise<Buffer> {
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
  await controller.downloadConfig(response, "11825", contentId, canvasUrl);
  expect(sent).toBeInstanceOf(Buffer);
  return sent as Buffer;
}

async function withConfig(run: () => Promise<void>, options: { encryptionEnabled?: boolean } = {}): Promise<void> {
  const previousCanvasBaseUrl = process.env.CANVAS_BASE_URL;
  const previousToolUrl = process.env.TOOL_URL;
  const previousEncryptionEnabled = process.env.SEB_CONFIG_ENCRYPTION_ENABLED;
  const previousPublicKeyPem = process.env.SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM;
  process.env.CANVAS_BASE_URL = CANVAS_URL;
  process.env.TOOL_URL = TOOL_URL;
  process.env.SEB_CONFIG_ENCRYPTION_ENABLED = options.encryptionEnabled ? "true" : "false";
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
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
