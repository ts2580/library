package com.proxy.library.book.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Value;

import java.io.*;
import java.util.Objects;

public class Auth {

    private final OkHttpClient client = new OkHttpClient();

    @Value("${salesforce.clientId}")
    private String clientId;

    @Value("${salesforce.clientSecret}")
    private String clientSecret;

    @Value("${salesforce.tokenUrl}")
    private String tokenUrl;


    public String getToken() throws JsonProcessingException {

        RequestBody requestBody = new FormBody.Builder()
                .add("grant_type", "client_credentials")
                .add("client_id", clientId)
                .add("client_secret", clientSecret)
                .build();

        Request tokenRequest = new Request.Builder()
                .url(tokenUrl)
                .post(requestBody)
                .build();

        try (Response tokenResponse = client.newCall(tokenRequest).execute()) {
            if (!tokenResponse.isSuccessful()) {
                return null;
            }

            String token = Objects.requireNonNull(tokenResponse.body()).string();

            ObjectMapper objectMapper = new ObjectMapper();
            JsonNode rootNode = objectMapper.readTree(token);

            return rootNode.get("access_token").asText();

        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

}
