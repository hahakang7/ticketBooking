# Frontend Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm ci

# 빌드
COPY . .
RUN npm run build

# Production 이미지
FROM node:18-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["serve", "-s", "dist", "-l", "3001"]
