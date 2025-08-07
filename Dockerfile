FROM node:22.17.1-bookworm AS base

RUN npm install -g corepack@latest
RUN corepack enable
RUN corepack prepare pnpm --activate

FROM base AS installer
WORKDIR /app
 
COPY package*json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --production

RUN npx playwright install
RUN npx playwright install-deps

COPY ./src/ ./src/

EXPOSE 3000
CMD ["node", "./src/index.mjs"]