import { describe, expect, it, vi } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { CanvasApiService } from "../../src/server/services/canvas-api.service.js";
import { DeepLinkModuleService } from "../../src/server/services/deep-link-module.service.js";

describe("DeepLinkModuleService", () => {
  it("updates matching New Quiz module items to LTI launch links", async () => {
    process.env.TOOL_URL = "https://tool.example.com";
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: "module-1" }])
      .mockResolvedValueOnce([{ id: "item-1", type: "Assignment", content_id: "99", title: "New Quiz" }])
      .mockResolvedValueOnce({});
    const canvas = {
      getCanvasApiBaseUrl: () => "https://canvas.example.com/api/v1",
      request
    } as unknown as CanvasApiService;
    const service = new DeepLinkModuleService(new AppConfig(), canvas);

    await expect(
      service.createOrUpdateModuleItemForContent(
        "course-7",
        {
          id: "newquiz:course-7:99",
          courseId: "course-7",
          canvasId: "99",
          assignmentId: "99",
          contentType: "NEW_QUIZ",
          title: "New Quiz"
        },
        "user-1",
        true
      )
    ).resolves.toBe(true);

    const updateBody = JSON.parse(request.mock.calls[2][2].body as string);
    expect(updateBody.module_item).toMatchObject({
      type: "ExternalTool",
      external_url: "https://tool.example.com/seb/launch/newquiz:course-7:99"
    });
  });
});
