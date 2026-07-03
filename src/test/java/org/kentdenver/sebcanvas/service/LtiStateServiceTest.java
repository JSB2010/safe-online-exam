package org.kentdenver.sebcanvas.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LtiStateServiceTest {

    @Test
    void stateCanOnlyBeConsumedOnce() {
        LtiStateService service = new LtiStateService(new ObjectMapper());
        String state = service.createState(Map.of(
                "nonce", "nonce-1",
                "target_link_uri", "https://app.example.com/seb/launch/classicquiz_1"));

        assertEquals("nonce-1", service.consumeState(state).get("nonce"));
        assertThrows(IllegalArgumentException.class, () -> service.consumeState(state));
    }
}
