FROM openjdk:17
ARG JAR_FILE=*.jar
COPY ${JAR_FILE} app.jar
EXPOSE 2580
ENTRYPOINT ["java","-jar","app.jar"]