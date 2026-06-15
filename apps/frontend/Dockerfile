# Frontend Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 설치 (lock file 버전 차이 방지를 위해 npm install 사용)
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 빌드
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_SOCKET_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN npm run build

# Production 이미지
FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["serve", "-s", "dist", "-l", "3001"]
