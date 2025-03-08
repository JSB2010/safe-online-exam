package org.kentdenver.sebcanvas.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
public class HomeController {

    /**
     * Handles direct access to the root path.
     * Provides information about the application instead of redirecting.
     */
    @GetMapping("/")
    @ResponseBody
    public String home() {
        return "Canvas SEB Integration is running! This is an LTI application designed to be launched from Canvas. " +
                "If you're trying to use this application, please access it through your Canvas course navigation.";
    }

    /**
     * Health check endpoint for Cloud Run.
     */
    @GetMapping("/health")
    @ResponseBody
    public String healthCheck() {
        return "OK";
    }
}