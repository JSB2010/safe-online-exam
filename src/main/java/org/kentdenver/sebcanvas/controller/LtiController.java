package org.kentdenver.sebcanvas.controller;

import org.kentdenver.sebcanvas.service.LtiService;
import org.kentdenver.sebcanvas.service.LtiService.LtiLaunchData;
import com.nimbusds.jose.JOSEException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.text.ParseException;

@Controller
@RequestMapping("/lti")
@RequiredArgsConstructor
@Slf4j
public class LtiController {

    private final LtiService ltiService;

    /**
     * Handle the OIDC login initiation from Canvas
     */
    @GetMapping("/login")
    public String handleLogin(
            @RequestParam("iss") String iss,
            @RequestParam("login_hint") String loginHint,
            @RequestParam("target_link_uri") String targetLinkUri,
            @RequestParam("client_id") String clientId,
            @RequestParam(value = "lti_message_hint", required = false) String ltiMessageHint,
            HttpSession session) {

        // Store parameters in session for the authorization step
        session.setAttribute("iss", iss);
        session.setAttribute("login_hint", loginHint);
        session.setAttribute("client_id", clientId);
        session.setAttribute("target_link_uri", targetLinkUri);
        if (ltiMessageHint != null) {
            session.setAttribute("lti_message_hint", ltiMessageHint);
        }

        // Redirect to the authorization endpoint
        return "redirect:/lti/auth";
    }

    /**
     * Handle the authorization request
     */
    @GetMapping("/auth")
    public String handleAuth(HttpSession session) {
        String iss = (String) session.getAttribute("iss");
        String loginHint = (String) session.getAttribute("login_hint");
        String clientId = (String) session.getAttribute("client_id");
        String targetLinkUri = (String) session.getAttribute("target_link_uri");
        String ltiMessageHint = (String) session.getAttribute("lti_message_hint");

        // Build the redirect URL to Canvas
        String authUrl = "https://sso.canvaslms.com/api/lti/authorize_redirect";
        String redirectUri = "https://your-app-domain.com/lti/launch";
        String state = "state-" + System.currentTimeMillis(); // For CSRF protection

        session.setAttribute("state", state);

        StringBuilder url = new StringBuilder(authUrl);
        url.append("?response_type=id_token");
        url.append("&client_id=").append(clientId);
        url.append("&redirect_uri=").append(redirectUri);
        url.append("&login_hint=").append(loginHint);
        url.append("&state=").append(state);
        url.append("&response_mode=form_post");
        url.append("&nonce=").append(System.currentTimeMillis());
        url.append("&prompt=none");
        url.append("&scope=openid");

        if (ltiMessageHint != null) {
            url.append("&lti_message_hint=").append(ltiMessageHint);
        }

        return "redirect:" + url.toString();
    }

    /**
     * Handle the launch from Canvas
     */
    @PostMapping("/launch")
    public String handleLaunch(
            @RequestParam("id_token") String idToken,
            @RequestParam("state") String state,
            HttpSession session,
            Model model) {

        // Verify state parameter
        String storedState = (String) session.getAttribute("state");
        if (!state.equals(storedState)) {
            return "error";
        }

        try {
            // Validate the ID token
            LtiLaunchData launchData = ltiService.validateToken(idToken);

            // Store launch data in session
            session.setAttribute("ltiLaunchData", launchData);

            // Determine the role and redirect accordingly
            if (launchData.isInstructor()) {
                return "redirect:/teacher/dashboard?courseId=" + launchData.getCourseId();
            } else if (launchData.isStudent()) {
                return "redirect:/student/quiz?courseId=" + launchData.getCourseId() +
                        "&resourceId=" + launchData.getResourceLinkId();
            } else {
                model.addAttribute("error", "Unsupported role");
                return "error";
            }

        } catch (ParseException | JOSEException | IOException e) {
            log.error("Error validating LTI token", e);
            model.addAttribute("error", "Failed to validate LTI launch: " + e.getMessage());
            return "error";
        }
    }
}