package com.example.bookshelf.integration.aladin;

import com.example.bookshelf.config.CacheConfig;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

@SpringJUnitConfig(classes = {CacheConfig.class, AladinClientCacheTest.TestConfig.class})
class AladinClientCacheTest {

    private static final String ISBN13 = "9781234567890";

    @Autowired
    private AladinClient aladinClient;

    @Autowired
    private AladinUrlBuilder urlBuilder;

    @Autowired
    private CacheManager cacheManager;

    private HttpServer server;
    private AtomicInteger dropshippingHits;
    private AtomicInteger usedInfoHits;
    private AtomicReference<String> searchRawQuery;

    @BeforeEach
    void setUp() throws IOException {
        cacheManager.getCache("aladinApiCache").clear();
        reset(urlBuilder);

        dropshippingHits = new AtomicInteger();
        usedInfoHits = new AtomicInteger();
        searchRawQuery = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/search", exchange -> {
            searchRawQuery.set(exchange.getRequestURI().getRawQuery());
            writeJson(exchange, """
                    {"totalResults":5,"item":[]}
                    """);
        });
        server.createContext("/dropshipping", exchange -> {
            dropshippingHits.incrementAndGet();
            writeJson(exchange, """
                    {"item":[{"title":"테스트 책","subInfo":{"usedList":{"aladinUsed":{"itemCount":1,"minPrice":1000,"link":"https://example.com/direct"},"spaceUsed":{"itemCount":1,"minPrice":2000,"link":"https://example.com/branch"}}}}]}
                    """);
        });
        server.createContext("/used-info", exchange -> {
            usedInfoHits.incrementAndGet();
            writeJson(exchange, """
                    {"itemOffStoreList":[{"offCode":"B1","offName":"강남점","link":"https://example.com/off"}]}
                    """);
        });
        server.start();

        String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        when(urlBuilder.isConfigured()).thenReturn(true);
        when(urlBuilder.bookSearchUrl(AladinSearchOptions.simple("르기아스", 1, 20)))
                .thenReturn(baseUrl + "/search?Query=%EB%A5%B4%EA%B8%B0%EC%95%84%EC%8A%A4");
        when(urlBuilder.dropshippingUsedBookUrl(ISBN13)).thenReturn(baseUrl + "/dropshipping");
        when(urlBuilder.usedBookInfoUrl(ISBN13)).thenReturn(baseUrl + "/used-info");
    }

    @Test
    void sendsPreEncodedBookSearchUrlWithoutDoubleEncoding() {
        AladinSearchResponse response = aladinClient.getBookInfo("르기아스", 1, 20);

        assertThat(response.totalResults()).isEqualTo(5);
        assertThat(searchRawQuery.get()).isEqualTo("Query=%EB%A5%B4%EA%B8%B0%EC%95%84%EC%8A%A4");
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
        cacheManager.getCache("aladinApiCache").clear();
    }

    @Test
    void cachesDropshippingAndUsedInfoSeparatelyForSameIsbn() {
        AladinDropshippingResponse dropshippingResponse = aladinClient.getDropshippingUsedBook(ISBN13);
        AladinUsedInfoResponse usedInfoResponse = aladinClient.getUsedBookInfo(ISBN13);

        assertThat(dropshippingResponse.getItem()).hasSize(1);
        assertThat(usedInfoResponse.getItemOffStoreList()).hasSize(1);
        assertThat(dropshippingHits).hasValue(1);
        assertThat(usedInfoHits).hasValue(1);

        aladinClient.getDropshippingUsedBook(ISBN13);
        aladinClient.getUsedBookInfo(ISBN13);

        assertThat(dropshippingHits).hasValue(1);
        assertThat(usedInfoHits).hasValue(1);
    }

    private static void writeJson(com.sun.net.httpserver.HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json;charset=UTF-8");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(bytes);
        }
    }

    @Configuration
    static class TestConfig {

        @Bean
        AladinClient aladinClient(AladinUrlBuilder urlBuilder, RestClient.Builder restClientBuilder) {
            return new AladinClient(urlBuilder, restClientBuilder);
        }

        @Bean
        AladinUrlBuilder aladinUrlBuilder() {
            return mock(AladinUrlBuilder.class);
        }

        @Bean
        RestClient.Builder restClientBuilder() {
            return RestClient.builder();
        }
    }
}
