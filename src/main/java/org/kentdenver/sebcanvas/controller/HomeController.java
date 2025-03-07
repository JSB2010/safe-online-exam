package org.kentdenver.sebcanvas.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
public class HomeController {

    @GetMapping("/")
    @ResponseBody
    public String home() {
        return "Canvas SEB Integration is running! This is an LTI application designed to be launched from Canvas.";
    }

    @GetMapping("/health")
    @ResponseBody
    public String healthCheck() {
        return "OK";
    }
}
