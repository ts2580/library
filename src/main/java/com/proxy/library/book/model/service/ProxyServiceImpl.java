package com.proxy.library.book.model.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.gson.Gson;
import com.proxy.library.book.common.Auth;
import com.proxy.library.book.model.dto.*;
import com.proxy.library.book.model.repository.ProxyRepository;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ProxyServiceImpl implements ProxyService {

    private final ProxyRepository proxyRepository;

    public Book findBook() {
        return proxyRepository.findBook();
	}

    public List<BookByVolume> getBookByVolume(String title){
        return proxyRepository.getBookByVolume(title);
    }

    public int insertBooks(List<Book> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.insertBooks(mapBooks);
    }

    public int insertBookByVolumes(List<BookByVolume> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.insertBookByVolumes(mapBooks);
    }

    public int updtBookByVolume(List<BookByVolume> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.updtBookByVolume(mapBooks);
    }

    public List<BookByVolume> getBookByVolumeNew(){
        return proxyRepository.getBookByVolumeNew();
    }

    public int insertStock(List<Branchbook> paramBooks){

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.insertStock(mapBooks);
    }

    public List<BookByVolume> getTargetBook() {
        return proxyRepository.getTargetBook();
    }

    public void delBooks() {
        proxyRepository.delBooks();
    }

    public void updtBookPrc() {
        proxyRepository.updtBookPrc();
    }

    public int setBookStockByBranch(List<Branchbook> paramBooks) {

        Map<String, Object> mapBooks = new HashMap<>();
        mapBooks.put("paramBooks", paramBooks);

        return proxyRepository.setBookStockByBranch(mapBooks);
    }

    public Def getObjDef() throws IOException {

        Auth auth = new Auth();
        ObjectMapper mapper = new ObjectMapper();

        String apiUrl = "https://daeu-4c-dev-ed.my.salesforce.com/services/apexrest/tooling/objDef";

        URL url = new URL(apiUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();

        connection.setRequestMethod("GET");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + auth.getToken());

        int responseCode = connection.getResponseCode();

        BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
        StringBuilder stringBuffer = new StringBuilder();
        String inputLine;

        while ((inputLine = bufferedReader.readLine()) != null)  {
            stringBuffer.append(inputLine);
        }
        bufferedReader.close();

        return mapper.readValue(stringBuffer.toString(), Def.class);
    }

    public Def getFieldDef(String qualifiedApiName) throws IOException {

        Auth auth = new Auth();
        ObjectMapper mapper = new ObjectMapper();

        String apiUrl = "https://daeu-4c-dev-ed.my.salesforce.com/services/apexrest/tooling/fieldDef/" + qualifiedApiName;

        URL url = new URL(apiUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();

        connection.setRequestMethod("GET");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + auth.getToken());

        int responseCode = connection.getResponseCode();

        BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
        StringBuilder stringBuffer = new StringBuilder();
        String inputLine;

        while ((inputLine = bufferedReader.readLine()) != null)  {
            stringBuffer.append(inputLine);
        }
        bufferedReader.close();


        Def def = mapper.readValue(stringBuffer.toString(), Def.class);

        StringBuilder DDL = new StringBuilder();
        DDL.append("create table devext.").append(qualifiedApiName).append("(");

        for(Def.Records obj : def.getFieldDef().getRecords()){

            if(obj.QualifiedApiName.equals("Id")){
                DDL.append("sfid character varying(18) primary key not null,");
            } else if (obj.ValueTypeId.equals("id")) {
                DDL.append(obj.QualifiedApiName).append(" character varying(18),");
            }else if (obj.ValueTypeId.equals("string")) {
                DDL.append(obj.QualifiedApiName).append(" character varying(").append(obj.Length).append("),");
            }else if (obj.ValueTypeId.equals("boolean")) {
                DDL.append(obj.QualifiedApiName).append(" boolean,");
            }else if (obj.ValueTypeId.equals("datetime")) {
                DDL.append(obj.QualifiedApiName).append(" timestamp without time zone,");
            }else if (obj.ValueTypeId.equals("double")) {
                DDL.append(obj.QualifiedApiName).append(" double precision,");
            }
        }

        DDL.deleteCharAt(DDL.length() - 1);
        DDL.append("); ");

        for(Def.Records obj : def.getFieldDef().getRecords()){
            if(obj.QualifiedApiName.equals("Id")){
                obj.QualifiedApiName = "sfid";
            }
            DDL.append("COMMENT ON COLUMN devext.").append(qualifiedApiName).append('.').append(obj.QualifiedApiName).append(" IS '").append(obj.Label).append("'; ");
        }

        Map<String,String> mapParam = new HashMap<>();

        mapParam.put("DDL", DDL.toString());

        proxyRepository.getFieldDef(mapParam);

        return def;
    }


}
















