FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 BIND_ADDRESS=0.0.0.0 DATABASE_PATH=/app/data/production.sqlite
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json THIRD_PARTY_NOTICES.txt ./
COPY --chown=node:node src ./src
COPY --chown=node:node host ./host
COPY --chown=node:node examples ./examples
COPY --chown=node:node tools ./tools
RUN mkdir /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","host/server.js"]
