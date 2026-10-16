package com.example.bookshelf.migration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@Service
@org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization
public class NextMigrationService {
    private final DataSource dataSource;
    private final MigrationWriteGate gate;
    private final ObjectMapper mapper;
    private final Executor stockExecutor;
    private final Executor coverExecutor;
    private final Path appDir;
    private final Path sourceCovers;
    private final String node;
    private final int port;
    private final String publicUrl;
    private final Map<String, String> runtimeEnv;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "NextMigration"); thread.setDaemon(true); return thread;
    });
    private Path sourceDatabase;
    private Path marker;
    private Path destination;
    private volatile Process process;
    private volatile boolean running;
    private volatile String phase = "IDLE";
    private volatile String message = "DB와 표지를 새 책장으로 이전합니다. 기존 계정은 그대로 사용할 수 있습니다.";
    private volatile int percent;

    public NextMigrationService(DataSource dataSource, MigrationWriteGate gate, ObjectMapper mapper,
            @Qualifier("stockRefreshExecutor") Executor stockExecutor,
            @Qualifier("coverArchiveExecutor") Executor coverExecutor,
            @Value("${app.next-migration.app-dir:./next}") String appDir,
            @Value("${app.covers.storage-dir:./data/covers}") String covers,
            @Value("${app.next-migration.node:node}") String node,
            @Value("${app.next-migration.port:25648}") int port,
            @Value("${app.next-migration.public-url:}") String publicUrl,
            @Value("${aladin.ttb-key:}") String aladinKey,
            @Value("${aladin.request.min-interval-ms:100}") String interval,
            @Value("${aladin.request.max-attempts:3}") String attempts,
            @Value("${aladin.request.initial-backoff-ms:2000}") String initialBackoff,
            @Value("${aladin.request.max-backoff-ms:30000}") String maxBackoff) {
        this.dataSource = dataSource; this.gate = gate; this.mapper = mapper;
        this.stockExecutor = stockExecutor; this.coverExecutor = coverExecutor;
        this.appDir = Path.of(appDir).toAbsolutePath().normalize();
        this.sourceCovers = Path.of(covers).toAbsolutePath().normalize();
        this.node = node; this.port = port; this.publicUrl = publicUrl;
        runtimeEnv = Map.of("ALADIN_TTB_KEY", aladinKey, "ALADIN_MIN_REQUEST_INTERVAL_MS", interval,
                "ALADIN_MAX_ATTEMPTS", attempts, "ALADIN_INITIAL_BACKOFF_MS", initialBackoff,
                "ALADIN_MAX_BACKOFF_MS", maxBackoff);
    }

    @PostConstruct
    void restore() throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement();
             var result = statement.executeQuery("PRAGMA database_list")) {
            while (result.next()) if ("main".equals(result.getString("name"))) {
                String file = result.getString("file");
                if (file != null && !file.isBlank()) sourceDatabase = Path.of(file).toAbsolutePath().normalize();
            }
        }
        if (sourceDatabase == null) return; // In-memory test DB cannot be handed over.
        marker = sourceDatabase.getParent().resolve("next-migration-state.json");
        if (!Files.exists(marker) && Files.exists(appDir.resolve("data/active-migration.json"))) {
            gate.freeze(); phase = "BLOCKED";
            message = "이미 적용된 Next.js 데이터가 있습니다. 기존 앱에서 다시 이전할 수 없습니다.";
            return;
        }
        if (Files.exists(marker)) {
            gate.freeze(); // Fail closed if a previous attempt was interrupted.
            try {
                JsonNode record = mapper.readTree(marker.toFile());
                destination = Path.of(record.path("destination").asText()).toAbsolutePath().normalize();
                if (!validDestination(destination)) throw new IOException("Invalid destination");
                phase = "INTERRUPTED";
                message = "이전 작업이 중단되었습니다. 이전 상태를 확인하고 다시 시작하세요.";
                refreshProgress();
                // A persisted COMPLETED report does not prove the children survived restart.
                phase = "INTERRUPTED";
                message = activated() ? "이전된 데이터가 있습니다. 새 책장 다시 시작을 누르세요."
                        : "복사 작업이 중단되었습니다. 다시 누르면 새 복사본으로 이전합니다.";
            } catch (Exception error) {
                phase = "BLOCKED"; message = "이전 상태 파일을 읽을 수 없습니다. 원본 보호를 위해 변경을 차단했습니다.";
            }
        }
    }

    public synchronized View status() {
        if (running) refreshProgress();
        JsonNode report = null;
        try { if (destination != null && Files.exists(destination.resolve("report.json"))) report = mapper.readTree(destination.resolve("report.json").toFile()); }
        catch (IOException ignored) { /* an incomplete report is not advertised */ }
        return new View(phase, message, percent, running, gate.frozen(), available(), port, publicUrl, report);
    }

    public synchronized View start(String owner) {
        if (running || "COMPLETED".equals(phase)) throw new IllegalStateException("이미 이전 중이거나 새 책장이 실행 중입니다.");
        if ("BLOCKED".equals(phase)) throw new IllegalStateException(message);
        if (!available()) throw new IllegalStateException("Next.js 실행 파일과 빌드가 필요합니다. 마이그레이션용 패키지를 먼저 설치하세요.");
        boolean resume = activated();
        if (resume && !destinationMatchesActive()) throw new IllegalStateException("활성 데이터와 이전 상태가 일치하지 않습니다. 원본 보호를 위해 다시 복사하지 않습니다.");
        if (!resume) destination = appDir.resolve("data/migrations/handover-" + UUID.randomUUID());
        try {
            Files.createDirectories(destination);
            Path temporary = marker.resolveSibling(marker.getFileName() + ".tmp");
            mapper.writeValue(temporary.toFile(), Map.of("version", 1, "destination", destination.toString()));
            Files.move(temporary, marker, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException error) { throw new IllegalStateException("이전 상태를 저장하지 못했습니다. 원본은 변경하지 않았습니다."); }
        gate.freeze(); running = true; phase = "WAITING"; percent = 1;
        message = "진행 중인 저장·재고·표지 작업이 끝나기를 기다리고 있습니다.";
        executor.execute(() -> run(owner, resume));
        return status();
    }

    private void run(String owner, boolean resume) {
        try {
            long deadline = System.nanoTime() + Duration.ofMinutes(5).toNanos();
            while (!gate.drained() || busy(stockExecutor) || busy(coverExecutor)) {
                if (System.nanoTime() >= deadline) throw new IOException("기존 작업이 끝나지 않았습니다. 작업 완료 후 다시 시도하세요.");
                Thread.sleep(200);
            }
            ProcessBuilder builder = new ProcessBuilder(node, "--conditions=react-server", "--import", "tsx", "scripts/migrate-legacy.ts");
            builder.directory(appDir.toFile());
            builder.redirectErrorStream(true);
            builder.redirectOutput(destination.resolve("runner.log").toFile());
            var environment = builder.environment();
            // Do not pass Java-only paths or arbitrary NODE_OPTIONS to the new runtime.
            environment.remove("NODE_OPTIONS");
            environment.remove("BOOKSHELF_DB_PATH"); environment.remove("BOOKSHELF_DATA_DIR");
            runtimeEnv.forEach((key, value) -> { if (!value.isBlank()) environment.put(key, value); });
            environment.put("NEXT_HANDOVER_SOURCE_DB", sourceDatabase.toString());
            environment.put("NEXT_HANDOVER_SOURCE_COVERS", sourceCovers.toString());
            environment.put("BOOKSHELF_LEGACY_DATA_DIR", sourceDatabase.getParent().toString());
            environment.put("NEXT_HANDOVER_DESTINATION", destination.toString());
            environment.put("NEXT_HANDOVER_OWNER", owner);
            environment.put("NEXT_HANDOVER_PORT", String.valueOf(port));
            environment.put("NEXT_HANDOVER_RESUME", String.valueOf(resume));
            process = builder.start();
            process.waitFor();
            refreshProgress();
            if (!TERMINAL_PHASES.contains(phase)) {
                phase = activated() ? "INTERRUPTED" : "FAILED";
                message = "이전 실행이 종료되었습니다. 실행 로그와 Node.js 설치 상태를 확인하세요.";
            }
        } catch (Exception error) {
            phase = activated() ? "INTERRUPTED" : "FAILED";
            message = error instanceof IOException && error.getMessage().startsWith("기존 작업")
                    ? error.getMessage() : "이전을 시작하지 못했습니다. Node.js 22 이상과 실행 환경을 확인하세요.";
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
        } finally {
            if (!activated()) {
                try { Files.deleteIfExists(marker); gate.thaw(); }
                catch (IOException error) { phase = "BLOCKED"; message = "이전 상태 정리에 실패했습니다. 원본 보호를 위해 변경을 차단했습니다."; }
            }
            running = false;
        }
    }

    private static final java.util.Set<String> TERMINAL_PHASES = java.util.Set.of("FAILED", "INTERRUPTED");
    private boolean available() {
        return sourceDatabase != null && port >= 1024 && port <= 65535
                && Files.isRegularFile(appDir.resolve("scripts/migrate-legacy.ts"))
                && Files.isRegularFile(appDir.resolve(".next/BUILD_ID"))
                && Files.isDirectory(appDir.resolve("node_modules/tsx"));
    }
    private boolean activated() {
        return Files.exists(appDir.resolve("data/active-migration.json"));
    }
    private boolean destinationMatchesActive() {
        try {
            Path pointer = appDir.resolve("data/active-migration.json");
            JsonNode active = mapper.readTree(pointer.toFile());
            Path target = appDir.resolve(active.path("dataDir").asText()).normalize();
            return active.path("version").asInt() == 1 && destination != null && target.equals(destination);
        } catch (IOException error) { return false; }
    }
    private boolean validDestination(Path target) {
        return target.getParent().equals(appDir.resolve("data/migrations"))
                && target.getFileName().toString().matches("handover-[a-f0-9-]+");
    }
    private void refreshProgress() {
        if (destination == null) return;
        try {
            JsonNode report = mapper.readTree(destination.resolve("progress.json").toFile());
            phase = report.path("phase").asText(phase);
            message = report.path("message").asText(message);
            percent = report.path("percent").asInt(percent);
        } catch (IOException ignored) { /* WAITING or starting, no complete progress yet */ }
    }
    private static boolean busy(Executor executor) {
        return executor instanceof ThreadPoolTaskExecutor pool
                && (pool.getActiveCount() > 0 || !pool.getThreadPoolExecutor().getQueue().isEmpty());
    }
    @PreDestroy
    void stop() {
        if (process != null && process.isAlive()) {
            process.destroy();
            try { if (!process.waitFor(15, java.util.concurrent.TimeUnit.SECONDS)) process.destroyForcibly(); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
        executor.shutdownNow();
    }
    public record View(String phase, String message, int percent, boolean running, boolean readOnly,
                       boolean available, int port, String publicUrl, JsonNode report) {}
}
