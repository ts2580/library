package com.example.bookshelf.integration.aladin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URI;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.LongSupplier;
import java.util.function.LongUnaryOperator;
import java.util.function.Supplier;

@Component
public class AladinClient {

    private static final Logger log = LoggerFactory.getLogger(AladinClient.class);

    private final AladinUrlBuilder urlBuilder;
    private final RestClient restClient;
    private final RequestSettings requestSettings;
    private final LongSupplier currentTimeMillis;
    private final Sleeper sleeper;
    private final LongUnaryOperator jitterMillis;
    private final Object requestPacingMonitor = new Object();
    private long nextRequestAtMillis;

    @Autowired
    public AladinClient(
            AladinUrlBuilder urlBuilder,
            RestClient.Builder restClientBuilder,
            @Value("${aladin.request.min-interval-ms:1000}") long minIntervalMs,
            @Value("${aladin.request.max-attempts:3}") int maxAttempts,
            @Value("${aladin.request.initial-backoff-ms:2000}") long initialBackoffMs,
            @Value("${aladin.request.max-backoff-ms:30000}") long maxBackoffMs
    ) {
        this(
                urlBuilder,
                restClientBuilder,
                new RequestSettings(minIntervalMs, maxAttempts, initialBackoffMs, maxBackoffMs),
                System::currentTimeMillis,
                Thread::sleep,
                upperBound -> upperBound <= 0 ? 0 : ThreadLocalRandom.current().nextLong(upperBound + 1)
        );
    }

    AladinClient(AladinUrlBuilder urlBuilder, RestClient.Builder restClientBuilder) {
        this(
                urlBuilder,
                restClientBuilder,
                new RequestSettings(0, 1, 0, 0),
                System::currentTimeMillis,
                Thread::sleep,
                ignored -> 0
        );
    }

    AladinClient(
            AladinUrlBuilder urlBuilder,
            RestClient.Builder restClientBuilder,
            RequestSettings requestSettings,
            LongSupplier currentTimeMillis,
            Sleeper sleeper,
            LongUnaryOperator jitterMillis
    ) {
        this.urlBuilder = urlBuilder;
        this.requestSettings = requestSettings;
        this.currentTimeMillis = currentTimeMillis;
        this.sleeper = sleeper;
        this.jitterMillis = jitterMillis;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(3_000);
        requestFactory.setReadTimeout(8_000);
        this.restClient = restClientBuilder.requestFactory(requestFactory).build();
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #query + ':' + #page + ':' + #pageSize")
    public AladinSearchResponse getBookInfo(String query, int page, int pageSize) {
        return getBookInfo(AladinSearchOptions.simple(query, page, pageSize));
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #options")
    public AladinSearchResponse getBookInfo(AladinSearchOptions options) {
        if (!isApiConfigured()) {
            return null;
        }
        return callForObject(urlBuilder.bookSearchUrl(options), AladinSearchResponse.class);
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #isbn13")
    public AladinDropshippingResponse getDropshippingUsedBook(String isbn13) {
        if (!isApiConfigured()) {
            return null;
        }
        return callForObject(urlBuilder.dropshippingUsedBookUrl(isbn13), AladinDropshippingResponse.class);
    }

    @Cacheable(cacheNames = "aladinApiCache", key = "#root.methodName + ':' + #isbn13")
    public AladinUsedInfoResponse getUsedBookInfo(String isbn13) {
        if (!isApiConfigured()) {
            return null;
        }
        return callForObject(urlBuilder.usedBookInfoUrl(isbn13), AladinUsedInfoResponse.class);
    }

    public String callRaw(String url) {
        return executeWithRetry(url, () -> restClient.get()
                .uri(URI.create(url))
                .retrieve()
                .body(String.class), true);
    }

    private <T> T callForObject(String url, Class<T> responseType) {
        return executeWithRetry(url, () -> restClient.get()
                .uri(URI.create(url))
                .retrieve()
                .body(responseType), false);
    }

    private <T> T executeWithRetry(String url, Supplier<T> request, boolean rawRequest) {
        String maskedUrl = maskSensitiveQueryParams(url);
        for (int attempt = 1; attempt <= requestSettings.maxAttempts(); attempt++) {
            synchronized (requestPacingMonitor) {
                if (!awaitRequestSlotLocked()) {
                    return null;
                }

                try {
                    return request.get();
                } catch (RestClientException e) {
                    boolean rateLimited = isRateLimited(e);
                    boolean retryable = isRetryable(e);
                    if (!retryable) {
                        logFinalFailure(maskedUrl, rawRequest, e);
                        return null;
                    }
                    if (attempt == requestSettings.maxAttempts()) {
                        if (rateLimited) {
                            throw new AladinRateLimitException(
                                    "알라딘 API 호출 제한(HTTP 429)이 재시도 후에도 계속되었습니다.",
                                    e
                            );
                        }
                        logFinalFailure(maskedUrl, rawRequest, e);
                        return null;
                    }

                    long delayMillis = retryDelayMillis(e, attempt);
                    log.warn(
                            "Aladin request failed; retrying attempt {}/{} after {}ms for url={}: {}",
                            attempt + 1,
                            requestSettings.maxAttempts(),
                            delayMillis,
                            maskedUrl,
                            failureSummary(e)
                    );
                    if (!pause(delayMillis)) {
                        return null;
                    }
                }
            }
        }
        return null;
    }

    private boolean awaitRequestSlotLocked() {
        long now = currentTimeMillis.getAsLong();
        long delayMillis = Math.max(0, nextRequestAtMillis - now);
        if (!pause(delayMillis)) {
            return false;
        }
        nextRequestAtMillis = currentTimeMillis.getAsLong() + requestSettings.minIntervalMs();
        return true;
    }

    private long retryDelayMillis(RestClientException exception, int failedAttempt) {
        long exponentialBackoff = requestSettings.initialBackoffMs();
        for (int i = 1; i < failedAttempt; i++) {
            exponentialBackoff = exponentialBackoff >= requestSettings.maxBackoffMs() / 2
                    ? requestSettings.maxBackoffMs()
                    : exponentialBackoff * 2;
        }

        long jitterUpperBound = exponentialBackoff / 4;
        long jitter = Math.max(0, Math.min(jitterUpperBound, jitterMillis.applyAsLong(jitterUpperBound)));
        long calculated = Math.min(requestSettings.maxBackoffMs(), exponentialBackoff + jitter);
        return Math.max(calculated, retryAfterMillis(exception));
    }

    private long retryAfterMillis(RestClientException exception) {
        if (!(exception instanceof HttpStatusCodeException statusException)
                || statusException.getResponseHeaders() == null) {
            return 0;
        }
        String retryAfter = statusException.getResponseHeaders().getFirst(HttpHeaders.RETRY_AFTER);
        if (retryAfter == null) {
            return 0;
        }
        try {
            long seconds = Long.parseLong(retryAfter.trim());
            return Math.min(requestSettings.maxBackoffMs(), Math.multiplyExact(seconds, 1_000));
        } catch (ArithmeticException | NumberFormatException ignored) {
            return 0;
        }
    }

    static boolean isRetryable(RestClientException exception) {
        return isRateLimited(exception) || exception instanceof ResourceAccessException;
    }

    private static boolean isRateLimited(RestClientException exception) {
        return exception instanceof HttpStatusCodeException statusException
                && statusException.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS;
    }

    private String failureSummary(RestClientException exception) {
        if (isRateLimited(exception)) {
            return "HTTP 429 Too Many Requests";
        }
        if (exception instanceof ResourceAccessException) {
            return "network timeout or connection failure";
        }
        return exception.getClass().getSimpleName();
    }

    private void logFinalFailure(String maskedUrl, boolean rawRequest, RestClientException exception) {
        if (rawRequest) {
            log.debug("Raw call failed for url={}", maskedUrl, exception);
        } else {
            log.warn("Aladin API call failed for url={}", maskedUrl, exception);
        }
    }

    private boolean pause(long delayMillis) {
        if (delayMillis <= 0) {
            return true;
        }
        try {
            sleeper.sleep(delayMillis);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Aladin request wait was interrupted");
            return false;
        }
    }

    public boolean isApiConfigured() {
        if (urlBuilder.isConfigured()) {
            return true;
        }
        log.warn("Aladin API key is not configured. Set ALADIN_TTB_KEY to enable external search and stock refresh.");
        return false;
    }

    private String maskSensitiveQueryParams(String url) {
        if (url == null) {
            return null;
        }
        return url.replaceAll("(?i)(ttbkey=)[^&]*", "$1****");
    }

    record RequestSettings(long minIntervalMs, int maxAttempts, long initialBackoffMs, long maxBackoffMs) {
        RequestSettings {
            if (minIntervalMs < 0) {
                throw new IllegalArgumentException("minIntervalMs must be non-negative");
            }
            if (maxAttempts < 1) {
                throw new IllegalArgumentException("maxAttempts must be at least 1");
            }
            if (initialBackoffMs < 0) {
                throw new IllegalArgumentException("initialBackoffMs must be non-negative");
            }
            if (maxBackoffMs < initialBackoffMs) {
                throw new IllegalArgumentException("maxBackoffMs must be greater than or equal to initialBackoffMs");
            }
        }
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(long millis) throws InterruptedException;
    }
}
