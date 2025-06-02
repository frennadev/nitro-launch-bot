import "./workers";
import { connectDB } from "../backend/db";
import { logger } from "./logger";

connectDB().then(() => {
  logger.info("[jobs]: 🚀  Jobs service online — workers registered");
});
