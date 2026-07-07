import { describe, expect, it, vi } from "vitest";
import plist from "plist";
import { AppConfig } from "../../src/server/config/app-config.js";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

const CANVAS_URL = "https://kentdenver.instructure.com";
const TOOL_URL = "https://tool.example.edu";

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
          saveSebSetting
        } as any,
        {} as any,
        {} as any,
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
        {} as any,
        {
          getSebSetting: async () => ({
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
          saveSebSetting
        } as any,
        {} as any,
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
