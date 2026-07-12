package com.example.bookshelf.user.service;

import com.example.bookshelf.common.Texts;
import com.example.bookshelf.integration.aladin.AladinUsedStockService;
import com.example.bookshelf.integration.aladin.AladinCoverUtils;
import com.example.bookshelf.user.model.Book;
import com.example.bookshelf.user.model.BookVolume;
import com.example.bookshelf.user.repository.BookDataRepository;
import com.example.bookshelf.user.repository.BookVolumeRepository;
import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

@Service
public class ProductService {

    private static final Logger log = LoggerFactory.getLogger(ProductService.class);
    private static final long MAX_COVER_BYTES = 8L * 1024 * 1024;
    private static final long MAX_COVER_PIXELS = 50_000_000L;
    private static final int MAX_REDIRECTS = 3;

    private final BookDataRepository bookDataRepository;
    private final BookVolumeRepository bookVolumeRepository;
    private final BranchInventoryRepository branchInventoryRepository;
    private final AladinUsedStockService aladinUsedStockService;
    private TransactionTemplate transactionTemplate;
    @Value("${app.covers.storage-dir:./data/covers}")
    private String coverStorageDir = "./data/covers";

    public ProductService(BookDataRepository bookDataRepository,
                          BookVolumeRepository bookVolumeRepository,
                          BranchInventoryRepository branchInventoryRepository,
                          AladinUsedStockService aladinUsedStockService) {
        this.bookDataRepository = bookDataRepository;
        this.bookVolumeRepository = bookVolumeRepository;
        this.branchInventoryRepository = branchInventoryRepository;
        this.aladinUsedStockService = aladinUsedStockService;
    }

    @Autowired
    void configureTransactionManager(PlatformTransactionManager transactionManager) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public int migrateOldCovers() {
        int count = 0;
        List<Book> books = bookDataRepository.findAllBooks();
        for (Book book : books) {
            List<BookVolume> volumes = bookVolumeRepository.findVolumesByBookId(book.id());
            String bookCoverCacheKey = resolveBookCoverCacheKey(book.id(), volumes);
            if (book.cover() != null && book.cover().startsWith("http")) {
                String newCover = downloadCoverImage(book.cover(), bookCoverCacheKey);
                if (!newCover.equals(book.cover())) {
                    bookDataRepository.updateBook(book.id(), book.name(), book.author(), book.description(), newCover, book.type(), book.totalvolume());
                    count++;
                }
            }

            for (BookVolume volume : volumes) {
                if (volume.cover() != null && volume.cover().startsWith("http")) {
                    String vCover = downloadCoverImage(volume.cover(), volume.isbn13() != null ? volume.isbn13() : "vol_" + volume.id());
                    if (!vCover.equals(volume.cover())) {
                        bookVolumeRepository.updateVolume(book.id(), volume.id(), volume.isbn13(), volume.name(), vCover, volume.price(), volume.description(), volume.purchased(), volume.noNeedToBuy(), volume.nullableSeq());
                        count++;
                    }
                }
            }
        }
        return count;
    }

    public ProductImportResult importProduct(ProductImportCommand command) {
        String normalizedTitle = Texts.trimToNull(command.title());
        String normalizedAuthor = Texts.trimToNull(command.author());
        String keyIsbn = resolveKeyIsbn(command.isbn13(), command.isbn());
        String normalizedType = Texts.trimToNull(command.type());
        String normalizedTotalVolume = Texts.trimToNull(command.totalVolume());
        Integer requestedVolume = normalizeRequestedVolume(command.volume());

        if (keyIsbn == null || keyIsbn.isEmpty()) {
            return ProductImportResult.error("ISBN13이 없는 항목은 중복 체크가 어려워 임시 등록이 제한됩니다.");
        }
        if (volumeExists(command, keyIsbn)) {
            return ProductImportResult.error("이미 같은 ISBN으로 등록된 권이 있습니다: " + keyIsbn);
        }

        String localCoverUrl = downloadCoverImage(command.cover(), keyIsbn);

        try {
            PersistedImport persisted = executeDbTransaction(() -> {
                if (volumeExists(command, keyIsbn)) {
                    throw new DuplicateKeyException("Duplicate ISBN for owner: " + keyIsbn);
                }
                BookTarget target = resolveBookTarget(command, normalizedTitle, normalizedAuthor, normalizedType, normalizedTotalVolume, requestedVolume, localCoverUrl);
                if (!target.success()) return PersistedImport.failure(target.message());
                int bookVolumeId = saveVolume(target.bookId(), target.seq(), keyIsbn, normalizedTitle, localCoverUrl, command.price(), command.description());
                return PersistedImport.success(bookVolumeId, target.bookId(), target.seq());
            });
            if (!persisted.success()) return ProductImportResult.error(persisted.message());

            int stockCount = refreshImportedVolumeStocks(persisted.bookVolumeId(), persisted.bookId(), persisted.seq(), normalizedTitle, keyIsbn);
            String stockMessage = stockCount < 0 ? " (재고 조회 실패)" : stockCount == 0 ? " (재고 정보 없음)" : " (중고 후보: " + stockCount + "개)";
            return ProductImportResult.success("등록 완료: " + normalizedTitle + stockMessage);
        } catch (DuplicateKeyException e) {
            return ProductImportResult.error("이미 같은 ISBN 또는 권 번호가 등록되어 있어 추가가 중단되었습니다: " + keyIsbn);
        }
    }

    private boolean volumeExists(ProductImportCommand command, String keyIsbn) {
        return command.ownerMemberId() == null
                ? bookVolumeRepository.existsVolumeByIsbn13(keyIsbn)
                : bookVolumeRepository.existsVolumeByIsbn13ForOwner(command.ownerMemberId(), keyIsbn);
    }

    private <T> T executeDbTransaction(Supplier<T> work) {
        return transactionTemplate == null ? work.get() : transactionTemplate.execute(status -> work.get());
    }

    private BookTarget resolveBookTarget(ProductImportCommand command,
                                         String normalizedTitle,
                                         String normalizedAuthor,
                                         String normalizedType,
                                         String normalizedTotalVolume,
                                         Integer requestedVolume,
                                         String localCoverUrl) {
        if (command.targetBookId() != null && command.targetBookId() > 0) {
            Book book = command.ownerMemberId() == null
                    ? bookDataRepository.findBookById(command.targetBookId())
                    : bookDataRepository.findBookByIdForOwner(command.targetBookId(), command.ownerMemberId());
            if (book == null) {
                return BookTarget.failure("선택한 Book를 찾을 수 없습니다. 새 Book로 등록해 주세요.");
            }
            int seq = requestedVolume != null ? requestedVolume : bookVolumeRepository.nextVolumeSeq(book.id());
            if (normalizedType != null || normalizedTotalVolume != null) {
                bookDataRepository.updateBook(
                        book.id(),
                        book.name(),
                        book.author(),
                        book.description(),
                        book.cover(),
                        normalizedType != null ? normalizedType : book.type(),
                        normalizedTotalVolume != null ? normalizedTotalVolume : book.totalvolume()
                );
            }
            return BookTarget.success(book.id(), seq);
        }

        Integer existingBookId = command.ownerMemberId() == null
                ? bookDataRepository.findBookIdByNameAndAuthor(normalizedTitle, normalizedAuthor)
                : bookDataRepository.findBookIdByNameAndAuthorForOwner(normalizedTitle, normalizedAuthor, command.ownerMemberId());
        if (existingBookId != null) {
            return BookTarget.failure("이미 동일한 제목/저자의 책이 존재합니다. 기존 책으로 추가하려면 상단에서 책을 선택해 주세요. (id:" + existingBookId + ")");
        }

        int bookId = command.ownerMemberId() == null
                ? bookDataRepository.insertBook(normalizedTitle, normalizedAuthor, Texts.trimToNull(command.description()), localCoverUrl, normalizedType, normalizedTotalVolume)
                : bookDataRepository.insertBookForOwner(command.ownerMemberId(), normalizedTitle, normalizedAuthor, Texts.trimToNull(command.description()), localCoverUrl, normalizedType, normalizedTotalVolume);
        int seq = requestedVolume != null ? requestedVolume : 1;
        return BookTarget.success(bookId, seq);
    }

    private int saveVolume(int bookId, int seq, String keyIsbn, String normalizedTitle, String cover, String price, String description) {
        return bookVolumeRepository.insertVolume(bookId, seq, keyIsbn, normalizedTitle, cover, Texts.trimToNull(price), Texts.trimToNull(description));
    }

    private int refreshImportedVolumeStocks(int bookVolumeId, int bookId, int seq, String title, String keyIsbn) {
        try {
            var lookup = aladinUsedStockService.lookupUsedStocksByIsbn13(keyIsbn);
            if (!lookup.successful()) {
                return -1;
            }
            var stocks = lookup.stocks();
            if (!stocks.isEmpty()) {
                branchInventoryRepository.insertBranchBooks(bookVolumeId, bookId, title, seq, stocks);
                branchInventoryRepository.rebuildBranchInventorySummary();
            }
            return stocks.size();
        } catch (RuntimeException e) {
            log.warn("Failed to refresh stocks for imported volume bookId={}, seq={}, isbn13={}", bookId, seq, keyIsbn, e);
            return -1;
        }
    }

    private String resolveKeyIsbn(String isbn13, String isbn) {
        String normalizedIsbn13 = Texts.trimToNull(isbn13);
        return normalizedIsbn13 != null ? normalizedIsbn13 : Texts.trimToNull(isbn);
    }

    private String resolveBookCoverCacheKey(int bookId, List<BookVolume> volumes) {
        if (volumes != null) {
            for (BookVolume volume : volumes) {
                if (volume == null) continue;
                String isbn13 = Texts.trimToNull(volume.isbn13());
                if (isbn13 != null) {
                    return isbn13 + "_book_" + bookId;
                }
            }
        }
        return "book_" + bookId;
    }

    private String downloadCoverImage(String coverUrl, String isbn) {
        if (coverUrl == null || coverUrl.isEmpty() || coverUrl.startsWith("/covers/")) {
            return coverUrl;
        }
        String highResUrl = AladinCoverUtils.toCover500(coverUrl);
        try {
            Path uploadDir = Paths.get(coverStorageDir);
            if (!Files.exists(uploadDir)) {
                Files.createDirectories(uploadDir);
            }
            
            String extension = safeImageExtension(coverUrl);
            String filename = sanitizeCoverFileKey(isbn) + extension;
            Path coverRoot = uploadDir.toAbsolutePath().normalize();
            Path filePath = coverRoot.resolve(filename).normalize();
            if (!filePath.startsWith(coverRoot)) {
                throw new IOException("Unsafe cover file path");
            }
            
            boolean downloaded = false;
            if (!highResUrl.equals(coverUrl)) {
                try {
                    downloadValidatedCover(highResUrl, filePath);
                    downloaded = true;
                } catch (Exception ignored) {
                    // Fallback to original url if high-res download fails
                }
            }
            
            if (!downloaded) {
                downloadValidatedCover(coverUrl, filePath);
            }
            return "/covers/" + filename;
        } catch (Exception e) {
            log.warn("Failed to download cover image from URL: {}", coverUrl, e);
            return highResUrl;
        }
    }

    private void downloadValidatedCover(String sourceUrl, Path destination) throws IOException, URISyntaxException {
        URI current = new URI(sourceUrl);
        for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
            validateCoverUri(current);
            HttpURLConnection connection = (HttpURLConnection) current.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(3_000);
            connection.setReadTimeout(8_000);
            connection.setRequestProperty("User-Agent", "Bookshelf/2 cover-fetcher");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || redirect == MAX_REDIRECTS) {
                    throw new IOException("Invalid cover redirect");
                }
                current = current.resolve(location);
                continue;
            }
            if (status != HttpURLConnection.HTTP_OK) {
                connection.disconnect();
                throw new IOException("Cover request failed with status " + status);
            }
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(Locale.ROOT).startsWith("image/")) {
                connection.disconnect();
                throw new IOException("Cover response is not an image");
            }
            long contentLength = connection.getContentLengthLong();
            if (contentLength > MAX_COVER_BYTES) {
                connection.disconnect();
                throw new IOException("Cover image is too large");
            }

            Path temp = Files.createTempFile(destination.getParent(), ".cover-", ".part");
            try {
                try (InputStream input = new BufferedInputStream(connection.getInputStream());
                     OutputStream output = Files.newOutputStream(temp, StandardOpenOption.TRUNCATE_EXISTING)) {
                    copyWithLimit(input, output);
                } finally {
                    connection.disconnect();
                }
                validateImageDimensions(temp);
                try {
                    Files.move(temp, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (IOException atomicMoveFailure) {
                    Files.move(temp, destination, StandardCopyOption.REPLACE_EXISTING);
                }
            } finally {
                Files.deleteIfExists(temp);
            }
            return;
        }
        throw new IOException("Too many cover redirects");
    }

    private void validateCoverUri(URI uri) throws IOException {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) {
            throw new IOException("Only HTTP(S) cover URLs are allowed");
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        if (!(normalizedHost.equals("aladin.co.kr") || normalizedHost.endsWith(".aladin.co.kr"))) {
            throw new IOException("Cover host is not allowed");
        }
        for (InetAddress address : InetAddress.getAllByName(host)) {
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress()) {
                throw new IOException("Cover host resolved to a private address");
            }
        }
    }

    private void copyWithLimit(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        long total = 0;
        int read;
        while ((read = input.read(buffer)) >= 0) {
            total += read;
            if (total > MAX_COVER_BYTES) {
                throw new IOException("Cover image exceeds the size limit");
            }
            output.write(buffer, 0, read);
        }
    }

    private void validateImageDimensions(Path imagePath) throws IOException {
        try (ImageInputStream imageInput = ImageIO.createImageInputStream(imagePath.toFile())) {
            if (imageInput == null) throw new IOException("Invalid image data");
            Iterator<ImageReader> readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) throw new IOException("Unsupported image format");
            ImageReader reader = readers.next();
            try {
                reader.setInput(imageInput, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width <= 0 || height <= 0 || (long) width * height > MAX_COVER_PIXELS) {
                    throw new IOException("Cover image dimensions are invalid");
                }
            } finally {
                reader.dispose();
            }
        }
    }

    private String sanitizeCoverFileKey(String key) {
        String normalized = key == null ? "" : key.replaceAll("[^A-Za-z0-9_-]", "_");
        if (normalized.length() > 80) normalized = normalized.substring(0, 80);
        return normalized.isBlank() ? UUID.randomUUID().toString() : normalized;
    }

    private String safeImageExtension(String coverUrl) {
        try {
            String path = new URI(coverUrl).getPath();
            if (path != null) {
                String lower = path.toLowerCase(Locale.ROOT);
                for (String extension : List.of(".jpg", ".jpeg", ".png", ".gif")) {
                    if (lower.endsWith(extension)) return extension;
                }
            }
        } catch (URISyntaxException ignored) {
            // The URL validator will report the malformed source.
        }
        return ".jpg";
    }

    private Integer normalizeRequestedVolume(Integer volume) {
        return volume != null && volume > 0 ? volume : null;
    }

    public String persistCoverImage(String coverUrl, String fileKey) {
        return downloadCoverImage(coverUrl, fileKey);
    }

    public void deleteLocalCoverFilesIfUnused(Collection<String> coverUrls) {
        if (coverUrls == null || coverUrls.isEmpty()) {
            return;
        }
        Set<String> localCoverUrls = new LinkedHashSet<>();
        for (String coverUrl : coverUrls) {
            String normalized = Texts.trimToNull(coverUrl);
            if (normalized != null && normalized.startsWith("/covers/")) {
                localCoverUrls.add(normalized);
            }
        }
        for (String coverUrl : localCoverUrls) {
            if (bookDataRepository.countByCover(coverUrl) > 0 || bookVolumeRepository.countByCover(coverUrl) > 0) {
                continue;
            }
            deleteLocalCoverFile(coverUrl);
        }
    }

    private void deleteLocalCoverFile(String coverUrl) {
        String filename = coverUrl.substring("/covers/".length());
        if (filename.isBlank() || filename.contains("/") || filename.contains("\\")) {
            log.warn("Skip unsafe local cover path during delete: {}", coverUrl);
            return;
        }
        try {
            Path coverRoot = Paths.get(coverStorageDir).toAbsolutePath().normalize();
            Path coverPath = coverRoot.resolve(filename).normalize();
            if (!coverPath.startsWith(coverRoot)) {
                log.warn("Skip local cover path outside storage dir during delete: {}", coverUrl);
                return;
            }
            Files.deleteIfExists(coverPath);
        } catch (Exception e) {
            log.warn("Failed to delete local cover file: {}", coverUrl, e);
        }
    }

    private record BookTarget(boolean success, int bookId, int seq, String message) {
        static BookTarget success(int bookId, int seq) {
            return new BookTarget(true, bookId, seq, null);
        }

        static BookTarget failure(String message) {
            return new BookTarget(false, 0, 0, message);
        }
    }

    private record PersistedImport(boolean success, int bookVolumeId, int bookId, int seq, String message) {
        static PersistedImport success(int bookVolumeId, int bookId, int seq) {
            return new PersistedImport(true, bookVolumeId, bookId, seq, null);
        }

        static PersistedImport failure(String message) {
            return new PersistedImport(false, 0, 0, 0, message);
        }
    }

    public record ProductImportCommand(
            String title,
            String author,
            String cover,
            String isbn13,
            String isbn,
            String price,
            String description,
            Integer targetBookId,
            Integer volume,
            String type,
            String totalVolume,
            Integer ownerMemberId
    ) {
        public ProductImportCommand(String title,
                                    String author,
                                    String cover,
                                    String isbn13,
                                    String isbn,
                                    String price,
                                    String description,
                                    Integer targetBookId,
                                    Integer volume,
                                    String type,
                                    String totalVolume) {
            this(title, author, cover, isbn13, isbn, price, description, targetBookId, volume, type, totalVolume, null);
        }
    }

    public record ProductImportResult(boolean success, String message) {
        public static ProductImportResult success(String message) {
            return new ProductImportResult(true, message);
        }

        public static ProductImportResult error(String message) {
            return new ProductImportResult(false, message);
        }
    }
}
