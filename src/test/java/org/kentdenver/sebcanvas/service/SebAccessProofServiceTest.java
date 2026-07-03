package org.kentdenver.sebcanvas.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SebAccessProofServiceTest {

    @Test
    void proofTokenIsBoundToCourseAndContentButNotBrowserSession() {
        SebAccessProofService service = new SebAccessProofService();
        String token = service.mintProof("course-1", "quiz-1");

        assertTrue(service.consumeProof(token, "course-1", "quiz-1"));
    }

    @Test
    void proofTokenCannotBeReusedForAnotherQuiz() {
        SebAccessProofService service = new SebAccessProofService();
        String token = service.mintProof("course-1", "quiz-1");

        assertFalse(service.consumeProof(token, "course-1", "quiz-2"));
    }

    @Test
    void proofTokenIsSingleUse() {
        SebAccessProofService service = new SebAccessProofService();
        String token = service.mintProof("course-1", "quiz-1");

        assertTrue(service.consumeProof(token, "course-1", "quiz-1"));
        assertFalse(service.consumeProof(token, "course-1", "quiz-1"));
    }
}
