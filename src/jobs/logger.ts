import { createLogger, format, transports } from "winston";
const { colorize, combine, timestamp, printf, errors, splat } = format;

const logFormat = printf(
  ({ level, message, timestamp, context, ...metadata }) => {
    const formattedMetadata = JSON.stringify(metadata);
    return `${timestamp}-[${level.toUpperCase().padEnd(5)}]: ${message} ${formattedMetadata}`;
  },
);

export const logger = createLogger({
  format: combine(timestamp(), errors({ stack: true }), splat()),
  transports: [
    new transports.Console({
      format: combine(colorize(), logFormat),
    }),
  ],
  exitOnError: false,
});
