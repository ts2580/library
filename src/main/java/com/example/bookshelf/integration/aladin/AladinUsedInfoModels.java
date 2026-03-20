package com.example.bookshelf.integration.aladin;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
class AladinDropshippingResponse {
    @JsonProperty("item")
    private List<AladinDropshippingItem> item;

    public List<AladinDropshippingItem> getItem() {
        return item;
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
class AladinDropshippingItem {
    @JsonProperty("title")
    private String title;

    @JsonProperty("link")
    private String link;

    @JsonProperty("subInfo")
    private AladinDropshippingSubInfo subInfo;

    public String getTitle() {
        return title;
    }

    public String getLink() {
        return link;
    }

    public AladinDropshippingSubInfo getSubInfo() {
        return subInfo;
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
class AladinDropshippingSubInfo {
    @JsonProperty("usedList")
    private AladinUsedList usedList;

    public AladinUsedList getUsedList() {
        return usedList;
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
class AladinUsedList {
    @JsonProperty("aladinUsed")
    private AladinUsedSummary aladinUsed;

    @JsonProperty("spaceUsed")
    private AladinUsedSummary spaceUsed;

    @JsonProperty("userUsed")
    private AladinUsedSummary userUsed;

    public AladinUsedSummary getAladinUsed() {
        return aladinUsed;
    }

    public AladinUsedSummary getSpaceUsed() {
        return spaceUsed;
    }

    public AladinUsedSummary getUserUsed() {
        return userUsed;
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
class AladinUsedSummary {
    @JsonProperty("itemCount")
    private Integer itemCount;

    @JsonProperty("minPrice")
    private Integer minPrice;

    @JsonProperty("link")
    private String link;

    public Integer getItemCount() {
        return itemCount;
    }

    public Integer getMinPrice() {
        return minPrice;
    }

    public String getLink() {
        return link;
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
class AladinUsedInfoResponse {
    @JsonProperty("itemOffStoreList")
    private List<AladinOffStoreItem> itemOffStoreList;

    public List<AladinOffStoreItem> getItemOffStoreList() {
        return itemOffStoreList;
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
class AladinOffStoreItem {
    @JsonProperty("offCode")
    private String offCode;

    @JsonProperty("offName")
    private String offName;

    @JsonProperty("link")
    private String link;

    @JsonProperty("minPrice")
    private Integer minPrice;

    public Integer getMinPrice() {
        return minPrice;
    }

    public String getOffCode() {
        return offCode;
    }

    public String getOffName() {
        return offName;
    }

    public String getLink() {
        return link;
    }
}
