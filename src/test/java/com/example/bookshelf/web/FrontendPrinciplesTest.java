package com.example.bookshelf.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

class FrontendPrinciplesTest {

    private static final Pattern INFORMAL_COPY = Pattern.compile("해요|했어요|없어요|있어요|예요|이에요|할게요|돼요|줘요");
    private static final Pattern FILLER_COPY = Pattern.compile("화면입니다|영역입니다|확인용입니다");

    @Test
    void visibleUiCopyUsesFormalNeutralTone() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path root : List.of(
                Path.of("src/main/resources/templates"),
                Path.of("src/main/resources/static/js"),
                Path.of("src/main/java/com/example/bookshelf"))) {
            collectCopyOffenders(root, INFORMAL_COPY, offenders);
            collectCopyOffenders(root, FILLER_COPY, offenders);
        }

        assertThat(offenders).isEmpty();
    }

    @Test
    void redirectedBookActionsShowFeedbackOnDestination() throws IOException {
        String bookList = read("src/main/resources/templates/book_list.html");
        String controller = read("src/main/java/com/example/bookshelf/web/BookshelfController.java");

        assertThat(controller)
                .contains("책 정보를 수정했습니다.")
                .contains("권 정보를 수정했습니다.")
                .contains("도서를 삭제했습니다.");
        assertThat(bookList).contains("flashMessages(${success}, ${error})");
    }

    @Test
    void productSearchAndImportFormsHaveExplicitLabels() throws IOException {
        String product = read("src/main/resources/templates/fragments/product.html");

        assertThat(product)
                .contains("for=\"aladinProductSearch\"")
                .contains(">기존 책<")
                .contains(">권 번호<")
                .contains(">카테고리<");
    }

    @Test
    void productImportUpdatesTheCardWithoutReloadingTheSearchPage() throws IOException {
        String product = read("src/main/resources/templates/fragments/product.html");
        String script = read("src/main/resources/static/js/product-search.js");
        String topProgress = read("src/main/resources/static/js/top-progress.js");
        String controller = read("src/main/java/com/example/bookshelf/web/ProductController.java");

        assertThat(product)
                .contains("data-product-card")
                .contains("data-product-status-chips")
                .contains("data-product-import-panel")
                .contains("data-top-progress-ignore")
                .contains("name=\"sideStory\" value=\"true\"")
                .contains("data-product-side-story")
                .contains("data-product-volume");
        assertThat(script)
                .contains("e.preventDefault();")
                .contains("body: new FormData(form)")
                .contains("'X-Requested-With': 'XMLHttpRequest'")
                .contains("markProductAsOwned(cardRoot);")
                .contains("volumeInput.disabled = sideStory;")
                .contains("if (sideStory) {")
                .contains("volumeInput.value = '';")
                .contains("window.__sparkProgress?.hide?.(80);");
        assertThat(topProgress)
                .contains("ignoresTopProgress(target)")
                .contains("[data-top-progress-ignore]")
                .contains("!ignoresTopProgress(event.target)");
        assertThat(controller)
                .contains("@RequestHeader(value = \"X-Requested-With\", required = false)")
                .contains("return ResponseEntity.ok(result);");
    }

    @Test
    void manualBookCreatePreviewsAladinCardsAndSubmitsOnlySelections() throws IOException {
        String bookList = read("src/main/resources/templates/book_list.html");
        String script = read("src/main/resources/static/js/book-list.js");
        String css = read("src/main/resources/static/css/bookshelf.css");
        String controller = read("src/main/java/com/example/bookshelf/web/BookshelfController.java");

        assertThat(bookList)
                .contains("id=\"bookCreatePreview\"")
                .contains("id=\"bookCreatePreviewCards\"")
                .contains("id=\"bookCreateSelectAll\"")
                .contains("id=\"bookCreateExcludeAll\"")
                .contains("name=\"selectionConfirmed\"")
                .contains("id=\"bookCreateTargetSearch\"")
                .contains("name=\"targetBookId\"")
                .contains("id=\"bookCreateNonAladin\"")
                .contains("name=\"author\"")
                .contains("name=\"description\"")
                .contains("name=\"cover\"")
                .contains("name=\"coverFile\"")
                .contains("enctype=\"multipart/form-data\"")
                .contains("name=\"totalvolume\"")
                .contains(">전체 선택<")
                .contains("추가 예정 확인")
                .doesNotContain("id=\"bookCreateSideStory\"");
        assertThat(script)
                .contains("/books/aladin-preview?name=")
                .contains("name=\"selectedIsbn\"")
                .contains("name=\"sideStoryIsbn\"")
                .contains("data-book-create-preview-card")
                .contains("data-book-create-exclude")
                .contains("data-book-create-side-story")
                .contains("bookshelf-book-create-preview-options")
                .contains("추가 예정")
                .contains("제외됨")
                .contains("/products/books/autocomplete?q=")
                .contains("typeInput.readOnly = true;")
                .contains("selectedTargetBook.nextVolume")
                .contains("syncNonAladinMode")
                .contains("bookCreateCoverFileField")
                .contains("validateCoverFile")
                .contains("directRegistration ? '입력 정보로 등록'")
                .contains("sideStoryCheckbox?.checked === true")
                .contains("selectionInput.disabled = !included");
        assertThat(css)
                .contains(".bookshelf-book-create-preview-grid")
                .contains(".bookshelf-book-create-preview-card.is-excluded")
                .contains(".bookshelf-book-create-preview-options");
        assertThat(controller)
                .contains("@GetMapping(\"/books/aladin-preview\")")
                .contains("@RequestParam(value = \"targetBookId\", required = false)")
                .contains("@RequestParam(value = \"selectedIsbn\", required = false)")
                .contains("@RequestParam(value = \"sideStoryIsbn\", required = false)")
                .contains("selectedKeys.contains(resolveAladinItemKey(item))")
                .contains("boolean sideStory = sideStoryKeys.contains(isbn);")
                .contains("bookVolumeRepository.nextVolumeSeq(bookId)")
                .contains("Integer volumeSeq = sideStory ? null : seq++;");
    }

    @Test
    void profilePageSeparatesIdentityAndSettingsAndSupportsInputAssistance() throws IOException {
        String profile = read("src/main/resources/templates/user_profile.html");
        String script = read("src/main/resources/static/js/user-profile.js");

        assertThat(profile)
                .contains("bookshelf-profile-identity")
                .contains("bookshelf-profile-settings-grid")
                .contains("maxlength=\"2000\"")
                .contains("autocomplete=\"name\"")
                .contains("autocomplete=\"email\"")
                .contains("data-password-toggle=\"profileCurrentPassword\"")
                .contains("data-password-toggle=\"profileNewPassword\"")
                .contains("/user/profile/backup/download")
                .contains("/user/profile/backup/upload")
                .contains("/user/profile/covers/archive/download")
                .contains("/user/profile/covers/archive/upload")
                .contains("/user/profile/covers/regenerate")
                .contains("name=\"backupFile\"")
                .contains("name=\"coverArchive\"")
                .contains("href=\"/user/profile/backup/download\" data-top-progress-ignore")
                .contains("href=\"/user/profile/covers/archive/download\" data-top-progress-ignore")
                .contains("data-cover-archive-upload-progress")
                .contains("data-cover-archive-upload-bar")
                .contains("/js/user-profile.js");
        assertThat(script)
                .contains("data-profile-description-count")
                .contains("data-backup-upload-form")
                .contains("data-cover-archive-upload-form")
                .contains("data-cover-regenerate-form")
                .contains("COVER_ARCHIVE_CHUNK_BYTES = 8 * 1024 * 1024")
                .contains("/user/profile/covers/archive/upload/chunk")
                .contains("/user/profile/covers/archive/upload/chunk/status?uploadId=")
                .contains("file.slice(")
                .contains("result.completed")
                .contains("result?.processing")
                .contains("window.__sparkProgress?.hide?.(80);")
                .contains("input.type = shouldShow ? 'text' : 'password';");
    }

    @Test
    void editDialogsExposeDialogSemanticsAndMoveFocus() throws IOException {
        String dialogs = read("src/main/resources/templates/fragments/book-detail/dialogs.html");
        String script = read("src/main/resources/static/js/book-detail.js");
        String bookList = read("src/main/resources/templates/book_list.html");
        String bookDetail = read("src/main/resources/templates/book_detail.html");

        assertThat(dialogs)
                .contains("id=\"bookEditDialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"bookEditTitle\"")
                .contains("id=\"volumeCreateDialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"volumeCreateTitle\"")
                .contains("id=\"volumeCreateNonAladin\"")
                .contains("id=\"volumeCreateSearchQuery\"")
                .contains("id=\"volumeEditDialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"volumeEditTitle\"")
                .contains("id=\"bookEditTotalVolume\" name=\"totalvolume\" type=\"text\" readonly")
                .contains("id=\"bookEditCoverFile\" name=\"coverFile\" type=\"file\"")
                .contains("id=\"bookEditForm\" method=\"post\" enctype=\"multipart/form-data\"")
                .contains("id=\"volumeCreateCoverFile\" name=\"coverFile\" type=\"file\"")
                .contains("id=\"volumeCreateForm\" method=\"post\" enctype=\"multipart/form-data\"")
                .contains("id=\"volumeEditSeq\" name=\"seq\" type=\"number\" min=\"1\" required")
                .contains("id=\"volumeEditSideStory\" name=\"sideStory\" type=\"checkbox\"");
        assertThat(script)
                .doesNotContain("document.getElementById('bookEditName')?.focus();")
                .doesNotContain("seqInput.focus();")
                .contains("bindVolumeCreation()")
                .contains("/books/aladin-preview?name=")
                .contains("directCheckbox?.checked === true")
                .contains("input[type=\"file\"][name=\"coverFile\"]")
                .contains("validateCoverFile(volumeCreateForm)")
                .contains("server-message:")
                .contains("seqInput.disabled = sideStory;")
                .contains("if (sideStory) seqInput.value = '';");
        assertThat(bookDetail).contains("id=\"openVolumeCreateDialog\"");
    }

    @Test
    void coverImagesFillFixedCoverFrames() throws IOException {
        String css = read("src/main/resources/static/css/bookshelf.css");
        String bookDetail = read("src/main/resources/templates/book_detail.html");
        String bookList = read("src/main/resources/templates/book_list.html");
        String coverPreview = read("src/main/resources/static/js/cover-preview.js");

        assertThat(css)
                .contains(".bookshelf-cover-hover {")
                .contains(".bookshelf-cover-hover > :not(.bookshelf-empty-cover):not(.bookshelf-cover-placeholder)")
                .contains(".bookshelf-cover-hover img")
                .contains("width: 100% !important;")
                .contains("height: 100% !important;")
                .contains("object-fit: contain !important;")
                .contains("-webkit-touch-callout: none;")
                .contains("transform: translate(-50%, -50%) scale(.98);")
                .contains("transform: translate(-50%, -50%) scale(1);")
                .contains(".bookshelf-cover-hover:hover img { transform: none; }");
        assertThat(bookDetail)
                .contains("bookshelf-cover-hover bookshelf-card-cover-wide relative overflow-hidden rounded-[18px]")
                .contains("bookshelf-cover-hover bookshelf-card-cover-wide relative w-full overflow-hidden rounded-[16px]");
        assertThat(bookList).contains("/js/cover-preview.js");
        assertThat(bookDetail).contains("/js/cover-preview.js");
        assertThat(coverPreview)
                .contains("const hoverDelayMs = 0;")
                .contains("const longPressDelayMs = 450;")
                .contains("naturalWidth")
                .contains("bookshelf-cover-original-preview")
                .contains("mouseenter")
                .contains("mouseleave")
                .contains("pointerdown")
                .contains("pointermove")
                .contains("pointerup")
                .contains("pointercancel")
                .contains("touchend")
                .contains("touchcancel")
                .contains("dragstart")
                .contains("contextmenu")
                .contains("longPressMoveTolerance");
    }

    @Test
    void mobileNavigationIsRenderedOutsideTheTransformedSidebar() throws IOException {
        String layout = read("src/main/resources/templates/fragments/layout.html");
        assertThat(layout.indexOf("</aside>"))
                .isLessThan(layout.indexOf("th:fragment=\"appMobileNav(activeKey)\""));

        for (String template : List.of(
                "dashboard.html", "book_list.html", "book_detail.html", "product_search.html",
                "branch_inventory_dashboard.html", "branch_stock_list.html", "user_profile.html",
                "aladin_search.html", "aladin_used_search.html")) {
            assertThat(read("src/main/resources/templates/" + template))
                    .as(template)
                    .contains("appMobileNav('");
        }
    }

    private void collectCopyOffenders(Path root, Pattern pattern, List<String> offenders) throws IOException {
        try (Stream<Path> paths = Files.walk(root)) {
            paths.filter(Files::isRegularFile)
                    .filter(path -> !path.toString().contains("bookshelf-tailwind.css"))
                    .forEach(path -> collectFromFile(path, pattern, offenders));
        }
    }

    private void collectFromFile(Path path, Pattern pattern, List<String> offenders) {
        try {
            List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
            for (int i = 0; i < lines.size(); i++) {
                if (pattern.matcher(lines.get(i)).find()) {
                    offenders.add(path + ":" + (i + 1) + ": " + lines.get(i).trim());
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read " + path, e);
        }
    }

    private String read(String path) throws IOException {
        return Files.readString(Path.of(path), StandardCharsets.UTF_8);
    }
}
