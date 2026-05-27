package com.example.bookshelf.integration.aladin;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record AladinSearchResponse(
    Integer totalResults,
    List<AladinItem> item
) {
}
