package com.example.bookshelf.migration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import static org.assertj.core.api.Assertions.*;

class NextMigrationServiceTest {
    @TempDir Path root;
    private NextMigrationService service;

    private NextMigrationService create(MigrationWriteGate gate) throws Exception {
        Path app = root.resolve("next");
        Files.createDirectories(app.resolve("scripts")); Files.createDirectories(app.resolve(".next")); Files.createDirectories(app.resolve("node_modules/tsx"));
        Files.writeString(app.resolve("scripts/migrate-legacy.ts"), ""); Files.writeString(app.resolve(".next/BUILD_ID"), "fixture");
        var ds = new DriverManagerDataSource("jdbc:sqlite:" + root.resolve("source.sqlite"));
        var result = new NextMigrationService(ds, gate, new ObjectMapper(), Runnable::run, Runnable::run,
                app.toString(), root.resolve("covers").toString(), "nonexistent-node-for-fixture", 25648, "", "", "100", "3", "2000", "30000");
        result.restore(); return result;
    }
    @AfterEach void cleanup() { if (service != null) service.stop(); }

    @Test
    void duplicateDoesNotStartAnotherCopyAndLaunchFailureUnfreezesOriginal() throws Exception {
        var gate = new MigrationWriteGate(); service = create(gate);
        assertThat(gate.enterWrite()).isTrue();
        assertThat(service.start("trstyq").readOnly()).isTrue();
        assertThatThrownBy(() -> service.start("trstyq")).isInstanceOf(IllegalStateException.class);
        assertThat(Files.exists(root.resolve("next-migration-state.json"))).isTrue();
        gate.leaveWrite();
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (service.status().running() && System.nanoTime() < deadline) Thread.sleep(20);
        assertThat(service.status().phase()).isEqualTo("FAILED");
        assertThat(gate.frozen()).isFalse();
        assertThat(Files.exists(root.resolve("next-migration-state.json"))).isFalse();
    }
    @Test
    void interruptedMigrationRestoresReadOnlyMode() throws Exception {
        Path destination = root.resolve("next/data/migrations/handover-aabb"); Files.createDirectories(destination);
        new ObjectMapper().writeValue(root.resolve("next-migration-state.json").toFile(), Map.of("version", 1, "destination", destination.toString()));
        var gate = new MigrationWriteGate(); service = create(gate);
        assertThat(gate.frozen()).isTrue();
        assertThat(service.status().phase()).isEqualTo("INTERRUPTED");
    }
    @Test
    void activeDestinationCannotBeOverwrittenIfSourceMarkerIsMissing() throws Exception {
        Path pointer = root.resolve("next/data/active-migration.json"); Files.createDirectories(pointer.getParent()); Files.writeString(pointer, "{}");
        var gate = new MigrationWriteGate(); service = create(gate);
        assertThat(gate.frozen()).isTrue();
        assertThat(service.status().phase()).isEqualTo("BLOCKED");
        assertThatThrownBy(() -> service.start("trstyq")).isInstanceOf(IllegalStateException.class);
    }
}
