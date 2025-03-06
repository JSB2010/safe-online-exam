package org.kentdenver.sebcanvas.model;

import com.google.cloud.firestore.annotation.DocumentId;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;
import java.util.ArrayList;

/**
 * Entity class representing a Safe Exam Browser configuration.
 * This class has been migrated from JPA to Firestore.
 *
 * Stores settings used to generate SEB configuration files (.seb)
 * based on the SEB specification.
 */
@Data
@NoArgsConstructor
public class SebConfig {
    /**
     * Unique identifier for this configuration.
     * In Firestore, this will be the document ID.
     */
    @DocumentId
    private String id;

    /**
     * Name of the configuration for identification
     */
    private String name;

    /**
     * Description of the configuration
     */
    private String description;

    /**
     * The raw SEB configuration file content, if storing pre-generated files.
     * In Firestore, large binary data should typically be stored in Cloud Storage
     * with just a reference stored in Firestore.
     */
    private String configFileStorageUri;

    // SEB Browser Settings
    /**
     * Whether users are allowed to quit SEB
     */
    private boolean allowQuit;

    /**
     * Whether users can reload the browser window
     */
    private boolean allowReload;

    /**
     * Whether SEB should block access to the file system
     */
    private boolean blockExplorer;

    /**
     * Whether screen capture should be disabled
     */
    private boolean disableScreenCapture;

    /**
     * Whether printing should be disabled
     */
    private boolean disablePrinting;

    /**
     * Whether the browser's right-click menu is enabled
     */
    private boolean enableRightClick;

    /**
     * Whether SEB should display a reload button
     */
    private boolean showReloadButton;

    /**
     * Whether browser plugins are enabled
     */
    private boolean enablePlugIns;

    // URL Settings
    /**
     * The URL that SEB should navigate to on startup
     */
    private String startURL;

    /**
     * URL that, when loaded, will cause SEB to quit
     */
    private String quitURL;

    // Security Settings
    /**
     * Hashed password required to quit SEB
     */
    private String quitPassword;

    /**
     * Hashed password required to access SEB admin settings
     */
    private String adminPassword;

    /**
     * Browser Exam Key for SEB validation
     */
    private String browserExamKey;

    /**
     * Whether to send Browser Exam Key in HTTP headers
     */
    private boolean sendBrowserExamKey;

    /**
     * Config Key for SEB validation
     */
    private String configKey;

    // URL Filtering
    /**
     * Whether URL filtering is enabled
     */
    private boolean urlFilterEnable;

    /**
     * List of allowed URL patterns (whitelist)
     * Stored as a simple array in Firestore
     */
    private List<String> allowedURLs = new ArrayList<>();

    /**
     * List of blocked URL patterns (blacklist)
     * Stored as a simple array in Firestore
     */
    private List<String> blockedURLs = new ArrayList<>();

    // Canvas-specific fields
    /**
     * Domain for Canvas instance (e.g., "myschool.instructure.com")
     */
    private String canvasDomain;

    /**
     * Course ID for the Canvas course
     */
    private String canvasCourseId;

    /**
     * Quiz ID for the Canvas quiz
     */
    private String canvasQuizId;
}