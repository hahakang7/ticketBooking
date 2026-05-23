# WebSocket Service Dockerfile
FROM node:18-alpine

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 소스 코드 복사
COPY . .

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV REDIS_HOST=redis
ENV REDIS_PORT=6379

CMD ["node", "src/index.js"]
