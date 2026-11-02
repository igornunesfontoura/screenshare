# Build a partir da raiz do repositório (o servidor importa ../shared):
#   docker build -f server/Dockerfile -t screenshare-signaling .
FROM node:24-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm ci --prefix server --omit=dev && npm cache clean --force

COPY shared/ shared/
COPY server/index.ts server/rooms.ts server/rate-limit.ts server/

ENV NODE_ENV=production PORT=8787
# Atrás de proxy (Fly.io, Render) use TRUST_PROXY=1 para o rate limit ver o IP real.
EXPOSE 8787
USER node
WORKDIR /app/server
CMD ["node", "index.ts"]
