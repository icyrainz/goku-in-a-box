FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src/ ./src/

RUN mkdir -p data/logs

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
