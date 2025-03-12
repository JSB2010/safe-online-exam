package org.kentdenver.sebcanvas.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

/**
 * Controller for handling errors and providing detailed diagnostic information.
 */
@Controller
public class CustomErrorController implements ErrorController {

    /**
     * Handles all errors and renders the error page with diagnostics.
     */
    @RequestMapping("/error")
    public String handleError(HttpServletRequest request, Model model) {
        // Get error details
        Object status = request.getAttribute("javax.servlet.error.status_code");
        Object exception = request.getAttribute("javax.servlet.error.exception");
        Object message = request.getAttribute("javax.servlet.error.message");
        Object path = request.getAttribute("javax.servlet.error.request_uri");

        // Add basic information to model
        model.addAttribute("status", status != null ? status : "Unknown");
        model.addAttribute("error", exception != null ? exception.toString() : "Unknown error");
        model.addAttribute("message", message != null ? message : "No message available");
        model.addAttribute("path", path != null ? path : "Unknown path");

        // Add request details for debugging
        model.addAttribute("method", request.getMethod());
        model.addAttribute("queryString", request.getQueryString());

        // Add headers (can be useful for debugging)
        Map<String, String> headers = new HashMap<>();
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String name = headerNames.nextElement();
            headers.put(name, request.getHeader(name));
        }
        model.addAttribute("headers", headers);

        return "error";
    }
}