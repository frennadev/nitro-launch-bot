import { createLogger, format, level, transports } from "winston";
const { colorize, combine, timestamp, printf, errors, splat, json } = format;

const pretty = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level.toUpperCase().padEnd(5)} ${stack ?? message}`;
});

export const logger = createLogger({
  format: combine(timestamp(), errors({ stack: true }), splat()),
  transports: [
    new transports.Console({
      format: combine(colorize(), pretty),
    }),
    new transports.File({
      filename: "error.log",
      level: "error",
      format: json(),
      maxsize: 1_048_576,
      maxFiles: 3,
    }),
  ],
  exitOnError: false,
});
