# syntax=docker/dockerfile:1.7

# Build stage: compile frontend CSS with Node + build Spring Boot jar
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# node/npm on Alpine
RUN apk add --no-cache nodejs npm

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run css:build
RUN ./gradlew bootJar --no-daemon -x test

# Runtime stage
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY --from=builder /app/build/libs/bookshelf-*.jar /app/app.jar
RUN mkdir -p /data
ENV SPRING_DATASOURCE_URL="jdbc:sqlite:/data/bookshelf.sqlite?foreign_keys=on&busy_timeout=5000"

EXPOSE 25647
VOLUME ["/data"]

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
