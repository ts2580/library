package com.example.bookshelf.integration.aladin;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class AladinClientRequestPolicyTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void retries429WithExponentialBackoff_thenReturnsSuccessfulResponse() throws IOException {
        AtomicInteger hits = new AtomicInteger();
        String url = startServer(exchange -> {
            if (hits.incrementAndGet() < 3) {
                exchange.getResponseHeaders().set("Retry-After", "0");
                writeResponse(exchange, 429, "rate limited");
                return;
            }
            writeResponse(exchange, 200, "ok");
        });
        List<Long> sleeps = new ArrayList<>();
        AladinClient client = client(
                new AladinClient.RequestSettings(0, 3, 2_000, 30_000),
                new AtomicLong(),
                sleeps
        );

        String response = client.callRaw(url);

        assertThat(response).isEqualTo("ok");
        assertThat(hits).hasValue(3);
        assertThat(sleeps).containsExactly(2_000L, 4_000L);
    }

    @Test
    void throwsRateLimitException_when429PersistsAfterRetries() throws IOException {
        AtomicInteger hits = new AtomicInteger();
        String url = startServer(exchange -> {
            hits.incrementAndGet();
            writeResponse(exchange, 429, "rate limited");
        });
        List<Long> sleeps = new ArrayList<>();
        AladinClient client = client(
                new AladinClient.RequestSettings(0, 2, 2_000, 30_000),
                new AtomicLong(),
                sleeps
        );

        assertThatThrownBy(() -> client.callRaw(url))
                .isInstanceOf(AladinRateLimitException.class)
                .hasMessageContaining("429");
        assertThat(hits).hasValue(2);
        assertThat(sleeps).containsExactly(2_000L);
    }

    @Test
    void spacesEveryOutboundRequestThroughOneGlobalPacingGate() throws IOException {
        String url = startServer(exchange -> writeResponse(exchange, 200, "ok"));
        AtomicLong currentTimeMillis = new AtomicLong();
        List<Long> sleeps = new ArrayList<>();
        AladinClient client = client(
                new AladinClient.RequestSettings(1_000, 1, 0, 0),
                currentTimeMillis,
                sleeps
        );

        assertThat(client.callRaw(url)).isEqualTo("ok");
        assertThat(client.callRaw(url)).isEqualTo("ok");

        assertThat(sleeps).containsExactly(1_000L);
    }

    @Test
    void treatsReadTimeoutAsRetryable() {
        ResourceAccessException timeout = new ResourceAccessException(
                "Read timed out",
                new SocketTimeoutException("Read timed out")
        );

        assertThat(AladinClient.isRetryable(timeout)).isTrue();
    }

    private AladinClient client(
            AladinClient.RequestSettings settings,
            AtomicLong currentTimeMillis,
            List<Long> sleeps
    ) {
        return new AladinClient(
                mock(AladinUrlBuilder.class),
                RestClient.builder(),
                settings,
                currentTimeMillis::get,
                millis -> {
                    sleeps.add(millis);
                    currentTimeMillis.addAndGet(millis);
                },
                ignored -> 0
        );
    }

    private String startServer(com.sun.net.httpserver.HttpHandler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/stock", handler);
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/stock";
    }

    private static void writeResponse(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(bytes);
        }
    }
}
