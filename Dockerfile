FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV npm_config_nodedir=/usr/local
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
WORKDIR /app
COPY . .
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV BOOKSHELF_DATA_DIR=/data
ENV BOOKSHELF_DB_PATH=/data/bookshelf.sqlite
ENV BOOKSHELF_LEGACY_DATA_DIR=/data/legacy
WORKDIR /app
RUN groupadd --system --gid 1001 bookshelf && useradd --system --uid 1001 --gid bookshelf --create-home bookshelf
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/app ./app
COPY --from=build /app/components ./components
COPY --from=build /app/features ./features
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
RUN mkdir -p /data/covers /data/uploads /data/backups /data/legacy /app/.next/cache \
    && chown -R bookshelf:bookshelf /data /app/.next/cache
USER bookshelf
EXPOSE 25647
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:25647/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
