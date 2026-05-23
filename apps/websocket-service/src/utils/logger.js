const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
}

class Logger {
  constructor(level = 'info') {
    this.level = LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO
  }

  error(message, data) {
    if (this.level >= LOG_LEVELS.ERROR) {
      console.error(`[ERROR] ${new Date().toISOString()} ${message}`, data || '')
    }
  }

  warn(message, data) {
    if (this.level >= LOG_LEVELS.WARN) {
      console.warn(`[WARN] ${new Date().toISOString()} ${message}`, data || '')
    }
  }

  info(message, data) {
    if (this.level >= LOG_LEVELS.INFO) {
      console.log(`[INFO] ${new Date().toISOString()} ${message}`, data || '')
    }
  }

  debug(message, data) {
    if (this.level >= LOG_LEVELS.DEBUG) {
      console.log(`[DEBUG] ${new Date().toISOString()} ${message}`, data || '')
    }
  }
}

export default new Logger(process.env.LOG_LEVEL || 'info')
