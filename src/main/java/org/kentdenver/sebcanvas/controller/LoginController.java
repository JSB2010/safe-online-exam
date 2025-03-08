package org.kentdenver.sebcanvas.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
public class LoginController {

    /**
     * Handles direct access to the login page.
     * This is separate from the LTI login flow.
     */
    @GetMapping("/login")
    public String login(@RequestParam(value = "error", required = false) String error,
                        @RequestParam(value = "logout", required = false) String logout,
                        Model model) {
        if (error != null) {
            model.addAttribute("error", "Invalid username and password.");
        }

        if (logout != null) {
            model.addAttribute("message", "You have been logged out successfully.");
        }

        return "login";
    }

    /**
     * Health check endpoint for the login controller.
     * Uses a different path to avoid conflict with HomeController
     */
    @GetMapping("/login/health")  // Changed from "/health" to "/login/health"
    @ResponseBody
    public String loginHealthCheck() {  // Renamed method to avoid confusion
        return "OK";
    }
}