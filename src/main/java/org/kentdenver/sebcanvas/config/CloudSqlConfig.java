package org.kentdenver.sebcanvas.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

import javax.sql.DataSource;

@Configuration
@Profile("prod")
public class CloudSqlConfig {

    @Value("${spring.datasource.username:}")
    private String dbUser;

    @Value("${spring.datasource.password:}")
    private String dbPass;

    @Value("${spring.datasource.name:sebdb}")
    private String dbName;

    @Value("${spring.cloud.gcp.sql.instance-connection-name:}")
    private String instanceConnectionName;

    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(String.format("jdbc:postgresql:///%s", dbName));
        config.setUsername(dbUser);
        config.setPassword(dbPass);
        config.addDataSourceProperty("socketFactory", "com.google.cloud.sql.postgres.SocketFactory");
        config.addDataSourceProperty("cloudSqlInstance", instanceConnectionName);

        return new HikariDataSource(config);
    }
}