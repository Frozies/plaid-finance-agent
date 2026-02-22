import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      return stack
        ? `${timestamp as string} [${level.toUpperCase()}] ${message as string}\n${stack as string}`
        : `${timestamp as string} [${level.toUpperCase()}] ${message as string}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'data/error.log', level: 'error', maxsize: 5242880, maxFiles: 3 }),
    new transports.File({ filename: 'data/combined.log', maxsize: 10485760, maxFiles: 5 }),
  ],
});

export default logger;
