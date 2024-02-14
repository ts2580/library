package com.proxy.library.book.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.proxy.library.book.model.dto.Token;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class Auth {

    public String getToken() throws JsonProcessingException {
        Map<String, String> mapParam = new HashMap<>();
        mapParam.put("grant_type", "password");
        mapParam.put("client_id", "REMOVED_SALESFORCE_CLIENT_ID");
        mapParam.put("client_secret", "REMOVED_SALESFORCE_CLIENT_SECRET");
        mapParam.put("username", "REMOVED_SALESFORCE_USERNAME");
        mapParam.put("password", "REMOVED_SALESFORCE_PASSWORD");

        StringBuilder urlencoded = new StringBuilder();

        for(String key : mapParam.keySet()){
            urlencoded.append(key).append('=').append(mapParam.get(key)).append('&');
        }

        URL url = null;
        String readLine = null;
        StringBuilder buffer = null;
        OutputStream outputStream = null;
        BufferedReader bufferedReader = null;
        BufferedWriter bufferedWriter = null;
        HttpURLConnection urlConnection = null;

        int connTimeout = 5000;
        int readTimeout = 3000;

        String sendData = urlencoded.toString();                        // 대다수의 경우 JSON 데이터 사용
        String apiUrl = "REMOVED_SALESFORCE_TOKEN_URL";    // 각자 상황에 맞는 IP & url 사용

        try {
            url = new URL(apiUrl);

            urlConnection = (HttpURLConnection)url.openConnection();
            urlConnection.setRequestMethod("POST");
            urlConnection.setConnectTimeout(connTimeout);
            urlConnection.setReadTimeout(readTimeout);
            urlConnection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;");
            urlConnection.setRequestProperty("Accept","*/*");
            urlConnection.setDoOutput(true);
            urlConnection.setInstanceFollowRedirects(true);

            outputStream = urlConnection.getOutputStream();

            bufferedWriter = new BufferedWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));
            bufferedWriter.write(sendData);
            bufferedWriter.flush();

            buffer = new StringBuilder();
            if(urlConnection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                bufferedReader = new BufferedReader(new InputStreamReader(urlConnection.getInputStream(), StandardCharsets.UTF_8));
                while((readLine = bufferedReader.readLine()) != null) {
                    buffer.append(readLine).append("\n");
                }
            } else {
                buffer.append("\"code\" : \"").append(urlConnection.getResponseCode()).append("\"");
                buffer.append(", \"message\" : \"").append(urlConnection.getResponseMessage()).append("\"");
            }
        } catch(Exception ex) {
            ex.printStackTrace();
        } finally {
            try {
                if (bufferedWriter != null) { bufferedWriter.close(); }
                if (outputStream != null) { outputStream.close(); }
                if (bufferedReader != null) { bufferedReader.close(); }
            } catch(Exception ex) {
                ex.printStackTrace();
            }
        }

        ObjectMapper mapper = new ObjectMapper();
        Token token = mapper.readValue(buffer.toString(), Token.class);

        return token.getAccess_token();
    }

}
