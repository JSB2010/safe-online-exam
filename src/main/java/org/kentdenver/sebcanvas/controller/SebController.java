package org.kentdenver.sebcanvas.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kentdenver.sebcanvas.service.SebService;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

@Controller
@RequestMapping("/seb")
@Slf4j
@RequiredArgsConstructor
public class SebController {
    private final SebService sebService;

    // Add your controller methods here
}