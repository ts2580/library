package com.example.bookshelf.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;
import java.nio.file.Paths;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path uploadDir = Paths.get("./data/covers");
        String uploadPath = uploadDir.toFile().getAbsolutePath();

        registry.addResourceHandler("/covers/**")
                .addResourceLocations("file:" + uploadPath + "/");
    }
}
