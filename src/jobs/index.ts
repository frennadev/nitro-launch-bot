import "./workers";
import { connectDB } from "../backend/db";

connectDB().then(() => {
  console.log("🚀  Jobs service online — workers registered");
});
