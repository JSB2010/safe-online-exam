package org.kentdenver.sebcanvas.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class ContentItemTest {

    @Test
    void newQuizContentIdUsesCourseAndAssignmentIdentity() {
        assertEquals("newquiz:course-7:99", ContentItem.newQuizContentId("course-7", "99"));
    }

    @Test
    void fromContentItemCopiesNewQuizIdentityIntoContentSebSetting() {
        ContentItem item = new ContentItem();
        item.setId(ContentItem.newQuizContentId("course-7", "99"));
        item.setCourseId("course-7");
        item.setCanvasId("99");
        item.setAssignmentId("99");
        item.setContentType(ContentItem.ContentType.NEW_QUIZ);
        item.setTitle("Checkpoint Quiz");
        item.setHtmlUrl("https://canvas.example.com/courses/7/assignments/99");
        item.setCanvasLaunchUrl("https://canvas.example.com/courses/7/external_tools/sessionless_launch?id=777");
        item.setResourceLinkUuid("resource-link-1");
        item.setLookupUuid("lookup-1");

        ContentSebSetting setting = ContentSebSetting.fromContentItem(item);

        assertEquals(item.getId(), setting.getId());
        assertEquals(item.getId(), setting.getContentId());
        assertEquals(ContentItem.ContentType.NEW_QUIZ, setting.getContentType());
        assertEquals("course-7", setting.getCourseId());
        assertEquals("99", setting.getCanvasId());
        assertEquals("99", setting.getAssignmentId());
        assertEquals(item.getHtmlUrl(), setting.getHtmlUrl());
        assertEquals(item.getCanvasLaunchUrl(), setting.getCanvasLaunchUrl());
        assertEquals(item.getResourceLinkUuid(), setting.getResourceLinkUuid());
        assertEquals(item.getLookupUuid(), setting.getLookupUuid());
        assertFalse(setting.isSebRequired());
        assertFalse(setting.isEnabled());
    }
}