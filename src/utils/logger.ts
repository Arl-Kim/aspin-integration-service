import winston from "winston";
import { config } from "../config/config.ts";

const { combine, timestamp, printf, colorize, json } = winston.format;

const consoleFormat = combine(
  colorize(),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  printf(({ level, message, timestamp, ...meta }) => {
    return `${timestamp} [${level}]: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta) : ""
    }`;
  })
);

const jsonFormat = combine(timestamp(), json());

export const logger = winston.createLogger({
  level: config.logging.level,
  format: config.env === "production" ? jsonFormat : consoleFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

// Create a child logger with correlation ID
export const createContextLogger = (correlationId: string) => {
  return logger.child({ correlationId });
};
