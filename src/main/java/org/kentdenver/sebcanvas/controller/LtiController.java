package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpSession;

@Controller
@RequestMapping("/lti")
@Slf4j
@RequiredArgsConstructor
public class LtiController {
    private final LtiService ltiService;

    // Add your controller methods here
}