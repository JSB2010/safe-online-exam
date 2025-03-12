package org.kentdenver.sebcanvas.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

/**
 * Custom error controller that provides enhanced error diagnostics.
 * This controller captures error details and presents them in a user-friendly format.
 * It's especially useful for troubleshooting LTI integration issues.
 */
@Controller
public class CustomErrorController implements ErrorController {

    /**
     * Handles all errors and renders the error page with detailed diagnostics.
     *
     * @param request The HTTP request that triggered the error
     * @param model The model to populate with error details
     * @return The view name for the error template
     */
    @RequestMapping("/error")
    public String handleError(HttpServletRequest request, Model model) {
        // Get standard error attributes from request
        Object status = request.getAttribute("javax.servlet.error.status_code");
        Object exception = request.getAttribute("javax.servlet.error.exception");
        Object message = request.getAttribute("javax.servlet.error.message");
        Object path = request.getAttribute("javax.servlet.error.request_uri");

        // Add basic error information to model
        model.addAttribute("status", status != null ? status : "Unknown");
        model.addAttribute("error", exception != null ? exception.toString() : "Unknown error");
        model.addAttribute("message", message != null ? message : "No message available");
        model.addAttribute("path", path != null ? path : "Unknown path");

        // Add request details for better diagnostics
        model.addAttribute("method", request.getMethod());
        model.addAttribute("queryString", request.getQueryString());

        // Add session information if available
        HttpSession session = request.getSession(false);
        if (session != null) {
            model.addAttribute("session", session);

            // Add session attributes for debugging
            Map<String, Object> sessionAttrs = new HashMap<>();
            Enumeration<String> attrNames = session.getAttributeNames();
            while (attrNames.hasMoreElements()) {
                String name = attrNames.nextElement();
                // Don't add sensitive data like passwords
                if (!name.toLowerCase().contains("password") &&
                        !name.toLowerCase().contains("secret") &&
                        !name.toLowerCase().contains("token")) {
                    sessionAttrs.put(name, session.getAttribute(name));
                } else {
                    sessionAttrs.put(name, "[REDACTED]");
                }
            }
            model.addAttribute("sessionAttributes", sessionAttrs);
        }

        // Add request headers for diagnostics
        Map<String, String> headers = new HashMap<>();
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String name = headerNames.nextElement();
            headers.put(name, request.getHeader(name));
        }
        model.addAttribute("headers", headers);

        // Add common LTI launch errors and solutions
        Map<String, String> ltiErrors = new HashMap<>();
        ltiErrors.put("Invalid state parameter",
                "The state parameter from Canvas doesn't match what was expected. This is common in stateless environments. Try again or clear your browser cache.");
        ltiErrors.put("Invalid nonce",
                "The nonce value in the token doesn't match what was expected. This happens when session state is lost between login and launch. Try refreshing and launching from Canvas again.");
        ltiErrors.put("Token expired",
                "The authentication token has expired. Try launching the tool again from Canvas.");
        ltiErrors.put("Invalid issuer",
                "The issuer claim in the token doesn't match the configured issuer. Check your LTI configuration.");
        ltiErrors.put("Invalid audience",
                "The audience claim in the token doesn't match your client ID. Check your LTI configuration.");
        model.addAttribute("ltiErrors", ltiErrors);

        // Return the error view
        return "error";
    }
}