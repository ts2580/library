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
RUN apk add --no-cache su-exec \
    && addgroup -S bookshelf \
    && adduser -S -G bookshelf bookshelf \
    && mkdir -p /data \
    && chown -R bookshelf:bookshelf /app /data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV SPRING_DATASOURCE_URL="jdbc:sqlite:/data/bookshelf.sqlite?foreign_keys=on&busy_timeout=5000"
ENV BOOKSHELF_COVER_DIR="/data/covers"

EXPOSE 25647
VOLUME ["/data"]

USER root

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
