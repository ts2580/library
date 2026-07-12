package com.example.bookshelf.user.model;

public record BookVolume(
        int id,
        int seq,
        int bookId,
        String isbn13,
        String name,
        String cover,
        String price,
        String description,
        boolean purchased,
        boolean noNeedToBuy,
        String volume
) {
    public boolean sideStory() {
        return volume == null || volume.isBlank();
    }

    public Integer nullableSeq() {
        return sideStory() ? null : seq;
    }
}
