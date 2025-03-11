package org.kentdenver.sebcanvas.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/debug")
public class DebugController {

    @GetMapping("/info")
    public Map<String, Object> getDebugInfo(HttpServletRequest request) {
        Map<String, Object> debugInfo = new HashMap<>();

        // Add request info
        debugInfo.put("requestMethod", request.getMethod());
        debugInfo.put("requestURI", request.getRequestURI());
        debugInfo.put("queryString", request.getQueryString());

        // Add headers
        Map<String, String> headers = new HashMap<>();
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String headerName = headerNames.nextElement();
            headers.put(headerName, request.getHeader(headerName));
        }
        debugInfo.put("headers", headers);

        // Add security info
        debugInfo.put("securityEnabled", "SecurityConfig with all paths permitted");

        return debugInfo;
    }
}
