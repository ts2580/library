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
                .contains("for=\"ownedProductSearch\"")
                .contains("for=\"aladinProductSearch\"")
                .contains(">기존 책<")
                .contains(">권 번호<")
                .contains(">타입<")
                .contains(">총 권수<");
    }

    @Test
    void editDialogsExposeDialogSemanticsAndMoveFocus() throws IOException {
        String dialogs = read("src/main/resources/templates/fragments/book-detail/dialogs.html");
        String script = read("src/main/resources/static/js/book-detail.js");

        assertThat(dialogs)
                .contains("id=\"bookEditDialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"bookEditTitle\"")
                .contains("id=\"volumeEditDialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"volumeEditTitle\"");
        assertThat(script)
                .contains("document.getElementById('bookEditName')?.focus();")
                .contains("seqInput.focus();");
    }

    private void collectCopyOffenders(Path root, Pattern pattern, List<String> offenders) throws IOException {
        try (Stream<Path> paths = Files.walk(root)) {
            paths.filter(Files::isRegularFile)
                    .filter(path -> !path.toString().contains("blinko-tailwind.css"))
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
