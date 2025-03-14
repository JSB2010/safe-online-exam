package org.kentdenver.sebcanvas.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.*;

/**
 * Diagnostic controller for investigating URL mapping issues.
 * This controller provides a view of all registered URL paths and their corresponding handlers.
 */
@Controller
@RequestMapping("/diagnostic")
@Slf4j
public class UrlRoutingDiagnosticController {

    private final ApplicationContext applicationContext;

    @Autowired
    public UrlRoutingDiagnosticController(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    /**
     * Displays all registered URL mappings in the application.
     * This is useful for diagnosing 404 errors and other routing issues.
     */
    @GetMapping("/url-mappings")
    @ResponseBody
    public Map<String, List<String>> getAllUrlMappings() {
        RequestMappingHandlerMapping mapping = applicationContext.getBean(RequestMappingHandlerMapping.class);
        Map<RequestMappingInfo, HandlerMethod> handlerMethods = mapping.getHandlerMethods();

        Map<String, List<String>> urlMappings = new TreeMap<>();

        handlerMethods.forEach((requestMappingInfo, handlerMethod) -> {
            // Get all paths for this mapping
            Set<String> patterns = requestMappingInfo.getPathPatternsCondition().getPatternValues();

            // Get controller class and method
            String controllerClass = handlerMethod.getBeanType().getSimpleName();
            String methodName = handlerMethod.getMethod().getName();
            String controllerMethod = controllerClass + "." + methodName;

            // Add each pattern to our result map
            for (String pattern : patterns) {
                if (!urlMappings.containsKey(pattern)) {
                    urlMappings.put(pattern, new ArrayList<>());
                }
                urlMappings.get(pattern).add(controllerMethod);
            }
        });

        return urlMappings;
    }

    /**
     * Provides a simple HTML page to navigate to all available debug endpoints.
     */
    @GetMapping("/tools")
    public String diagnosticTools(Model model) {
        // Get all URL mappings for diagnostic controllers
        RequestMappingHandlerMapping mapping = applicationContext.getBean(RequestMappingHandlerMapping.class);
        Map<RequestMappingInfo, HandlerMethod> handlerMethods = mapping.getHandlerMethods();

        List<Map<String, Object>> diagnosticUrls = new ArrayList<>();

        handlerMethods.forEach((requestMappingInfo, handlerMethod) -> {
            String controllerClass = handlerMethod.getBeanType().getSimpleName();

            // Only include diagnostic/debug controllers
            if (controllerClass.contains("Debug") || controllerClass.contains("Diagnostic")) {
                Set<String> patterns = requestMappingInfo.getPathPatternsCondition().getPatternValues();

                for (String pattern : patterns) {
                    Map<String, Object> endpoint = new HashMap<>();
                    endpoint.put("url", pattern);
                    endpoint.put("controller", controllerClass);
                    endpoint.put("method", handlerMethod.getMethod().getName());

                    // Extract HTTP method
                    String httpMethod = requestMappingInfo.getMethodsCondition().toString();
                    endpoint.put("httpMethod", httpMethod.replace("[", "").replace("]", ""));

                    diagnosticUrls.add(endpoint);
                }
            }
        });

        model.addAttribute("diagnosticUrls", diagnosticUrls);
        return "diagnosticTools";
    }
}