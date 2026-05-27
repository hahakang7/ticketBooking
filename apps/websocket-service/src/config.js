import dotenv from 'dotenv'

dotenv.config()

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000'),
  HOST: process.env.HOST || '0.0.0.0',
  
  // Redis 설정
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379'),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
  REDIS_DB: parseInt(process.env.REDIS_DB || '0'),
  
  // API 서버 설정
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:8000',

  // 내부 서비스 간 통신
  JWT_SECRET: process.env.JWT_SECRET || process.env.SECRET_KEY || '',
  INTERNAL_SECRET: process.env.INTERNAL_SECRET || '',
  
  // CORS 설정
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  
  // 로깅
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
}

export default config
