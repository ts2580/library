package com.example.bookshelf.web;

import com.example.bookshelf.migration.NextMigrationService;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/user/profile/next-migration")
public class NextMigrationController {
    private final NextMigrationService service;
    public NextMigrationController(NextMigrationService service) { this.service = service; }

    @GetMapping("/status")
    public ResponseEntity<NextMigrationService.View> status() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.status());
    }
    @PostMapping("/start")
    public ResponseEntity<?> start(Authentication authentication) {
        try { return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(service.start(authentication.getName())); }
        catch (IllegalStateException error) { return ResponseEntity.status(409).body(Map.of("error", error.getMessage())); }
    }
}
