package org.kentdenver.sebcanvas.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import javax.persistence.*;

@Entity
@Data
@NoArgsConstructor
public class SebConfig {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private String description;

    @Lob
    private byte[] configFileContent;

    // Settings for SEB
    private boolean allowQuit;
    private boolean blockExplorer;
    private boolean disableScreenCapture;
    private boolean disablePrinting;
    private String startURL;
    private String quitURL;
    private String quitPassword;
    private String adminPassword;
}