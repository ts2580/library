package com.proxy.library.book.model.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
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
import java.util.*;

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

        // 아래에서 DML 만들때 쓸꺼임. 완전한 동적 DML 만들 떄 필요함
        Map<String, Object> mapType = new TreeMap<>();

        for(Def.Records obj : def.getFieldDef().getRecords()){

            mapType.put(obj.QualifiedApiName, obj.ValueTypeId);

            // 세일즈포스에서 만드는 모든 필드타입들은 하단의 Type으로 모인다
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
            }else if (obj.ValueTypeId.equals("date")) {
                DDL.append(obj.QualifiedApiName).append(" date,");
            }else if (obj.ValueTypeId.equals("time")) {
                DDL.append(obj.QualifiedApiName).append(" time without time zone,");
            }else if (obj.ValueTypeId.equals("double")) {
                DDL.append(obj.QualifiedApiName).append(" double precision,");
            }
        }

        DDL.deleteCharAt(DDL.length() - 1);
        DDL.append("); ");

        // 내건 주석도 달아줌. 이거 좀 크다
        for(Def.Records obj : def.getFieldDef().getRecords()){
            if(obj.QualifiedApiName.equals("Id")){
                obj.QualifiedApiName = "sfid";
            }
            DDL.append("COMMENT ON COLUMN devext.").append(qualifiedApiName).append('.').append(obj.QualifiedApiName).append(" IS '").append(obj.Label).append("'; ");
        }

        Map<String,String> mapParam = new HashMap<>();

        mapParam.put("DDL", DDL.toString());

        proxyRepository.getFieldDef(mapParam);

        mapper = new ObjectMapper();

        apiUrl = "https://daeu-4c-dev-ed.my.salesforce.com/services/apexrest/table/" + qualifiedApiName;

        url = new URL(apiUrl);
        connection = (HttpURLConnection) url.openConnection();

        connection.setRequestMethod("GET");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + auth.getToken());

        responseCode = connection.getResponseCode();

        bufferedReader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
        stringBuffer = new StringBuilder();

        while ((inputLine = bufferedReader.readLine()) != null)  {
            stringBuffer.append(inputLine);
        }
        bufferedReader.close();

        ObjectMapper objectMapper = new ObjectMapper();
        List<Map<String, Object>> arrMap = objectMapper.readValue(stringBuffer.toString(), List.class);

        StringBuilder upperDML = new StringBuilder("INSERT INTO devext." + qualifiedApiName + "(");

        // ** 완전 동적 DML이기 때문에 정렬을 정확하게 해야함!

        // 1. Insert 구문 만들기

        mapType.forEach((key, value)->{
            if(key.equals("Id")){
                key = "sfid";
            }
            upperDML.append(key).append(",");
        });

        upperDML.deleteCharAt(upperDML.length() - 1);
        upperDML.append(") VALUES ");

        // 2. VALUES 구문 만들기
        List<String> listUnderDML = new ArrayList<>();
        Map<String, Object> sortedMap;

        List<String> listTemp;
        List<String> listTemp2;
        for(Map<String, Object> map : arrMap){

            // 세일즈포스에서 List<Sobject> 긁어올 시 따라오는 메타데이터 제거
            map.remove("attributes");

            // 세일즈포스에선 쿼리 결과 없으면 그냥 결과에서 제거해버림.
            // 우린 완전 동적 쿼리니까 insert 절과 values 절의 길이 맞춰 줘야됨!!
            listTemp = new ArrayList<>(mapType.keySet());
            listTemp2 = new ArrayList<>(mapType.keySet());
            
            // mapType(DDL시 사용함)과 map(쿼리로 긁어온 데이터)의 공통된 부분을 구한다음
            listTemp.retainAll(map.keySet());

            // 그걸 빼서 여집합을 만들고(셀포에서 불러오지 못한 필드들)
            listTemp2.removeAll(listTemp);

            // 그 여집합 필드에 null 넣어줘
            for(String temp : listTemp2){
                map.put(temp, null);
            }

            StringBuilder underDML = new StringBuilder("(");
            sortedMap = new TreeMap<>(map);
            sortedMap.forEach((key, value)->{
                // type이 boolean이나 double이 아니고 value가 null이 아닐 때 작은따옴표로 감싸줘
                if((!mapType.get(key).equals("boolean") || !mapType.get(key).equals("double")) && !Objects.isNull(value)){
                    underDML.append("'").append(value).append("'").append(",");
                }else{
                    underDML.append(value).append(",");
                }
            });
            underDML.deleteCharAt(underDML.length() - 1);
            underDML.append(")");
            listUnderDML.add(underDML.toString());
        }

        ParamVo pv = new ParamVo();
        pv.setListUnderDML(listUnderDML);
        pv.setUpperDML(upperDML.toString());

        int insertedData = proxyRepository.insertWithNoDto(pv);

        System.out.println("삽인된 데이터 수 : " + insertedData);

        return def;
    }
}
















