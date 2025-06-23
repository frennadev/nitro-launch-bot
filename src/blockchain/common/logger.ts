import { createLogger, format, transports } from "winston";
const { colorize, combine, printf } = format;

const logFormat = printf(
  ({ level, message, ...metadata }) => {
    const formattedMetadata = Object.keys(metadata).length ? JSON.stringify(metadata): "";
    return `[bot]: ${message} ${formattedMetadata}`;
  },
);

export const logger = createLogger({
  transports: [
    new transports.Console({
      level: "info",
      format: combine(colorize(), logFormat),
    }),
  ],
  exitOnError: false,
});
