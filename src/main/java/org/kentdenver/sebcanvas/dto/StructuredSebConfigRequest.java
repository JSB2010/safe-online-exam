package org.kentdenver.sebcanvas.dto;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Data Transfer Object for structured SEB configuration requests.
 * This class represents the new structured approach to SEB domain configuration
 * with separate categories for SSO, educational tools, and custom domains.
 */
@Data
@NoArgsConstructor
public class StructuredSebConfigRequest {
    
    /**
     * The quiz ID for which SEB configuration is being set.
     */
    private String quizId;

    /**
     * Content-scoped ID for non-classic instructor flows (for example New Quizzes).
     */
    private String contentId;
    
    /**
     * List of SSO domains that students need to access for authentication.
     * Examples: accounts.google.com, login.microsoftonline.com
     */
    private List<String> ssoDomains;
    
    /**
     * List of educational tool domains that are allowed for the quiz.
     * Examples: www.desmos.com/calculator, www.khanacademy.org
     */
    private List<String> educationalToolDomains;
    
    /**
     * List of custom domains specified by the teacher.
     * These are additional domains beyond the standard SSO and educational tools.
     */
    private List<String> customDomains;
    
    /**
     * The external tool URL for Canvas integration.
     * This URL is used for LTI Deep Linking to integrate SEB with Canvas modules.
     */
    private String externalToolUrl;
    
    /**
     * Password required to quit SEB.
     * If not provided, a default password will be used.
     */
    private String quitPassword;
}
