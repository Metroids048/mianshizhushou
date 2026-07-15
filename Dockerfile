FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV SERVER_PORT=8787
ENV AI_JOB_DB_PATH=/data/ai-job-platform.sqlite

VOLUME ["/data"]

EXPOSE 8787

CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
