# syntax=docker/dockerfile:1.7

# Build stage: compile frontend CSS with Node + build Spring Boot jar
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# node/npm on Alpine
RUN apk add --no-cache nodejs npm

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run css:build
RUN ./gradlew bootJar --no-daemon -x test

# Runtime stage
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY --from=builder /app/build/libs/bookshelf-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 25647

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
