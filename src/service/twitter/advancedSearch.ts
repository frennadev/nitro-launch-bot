import axios from "axios";
import { AdvancedData, Tweet, TweetsResponse } from "./interfaces";
import { RedisService } from "../RedisService";
import { config } from "dotenv";
config();

// Configuration
const API_KEY = process.env.TWITTER_API_KEY;

export async function checkForNewTweets(username: string): Promise<Tweet[]> {
  // Get last checked time from Redis for this specific account
  const lastCheckedTime = await RedisService.getLastCheckedTime(username);
  const untilTime = new Date();
  const sinceTime = lastCheckedTime;

  const sinceStr = formatDateForTwitter(sinceTime);
  const untilStr = formatDateForTwitter(untilTime);

  const query = `from:${username} since:${sinceStr} until:${untilStr} include:nativeretweets`;

  const url = "https://api.twitterapi.io/twitter/tweet/advanced_search";

  // Request parameters
  const baseParams = {
    query: query,
    queryType: "Latest",
  };

  const headers = {
    "X-API-Key": API_KEY,
  };

  const allTweets: Tweet[] = [];
  let nextCursor: string | null = null;

  const params: any = { ...baseParams };
  if (nextCursor) {
    params.cursor = nextCursor;
  }

  try {
    const response = await axios.get<AdvancedData>(url, {
      headers,
      params,
    });

    // Parse the response
    if (response.status === 200) {
      const data = response.data;
      // console.log(`Last checked time for ${username}:`, lastCheckedTime);
      // console.log(sinceStr, untilStr);
      // console.log(`${username}: Response: ${JSON.stringify(data, null, 2)}`);
      const tweets = data.tweets || [];

      if (tweets.length > 0) {
        allTweets.push(...tweets);
      }

      // Check if there are more pages
      if (data.has_next_page && data.next_cursor && data.next_cursor !== "") {
        nextCursor = data.next_cursor;
      } else {
      }
    } else {
      console.log(`Error: ${response.status} - ${response.statusText}`);
    }
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.log(
        `Error: ${error.response?.status || "Unknown"} - ${
          error.response?.data || error.message
        }`
      );
    } else {
      console.log(`Error: ${error.message || "Unknown error occurred"}`);
    }
  }

  if (allTweets.length > 0) {
    console.log(`Found ${allTweets.length} total tweets from ${username}!`);
    for (const tweet of allTweets) {
      console.log(`[${tweet.createdAt}] ${tweet.text}`);
    }

    // Update the last checked time in Redis for this account
    await RedisService.setLastCheckedTime(username, untilTime);
  } else {
    console.log(`No new tweets from ${username} since last check.`);

    // Even if no tweets found, update the timestamp to avoid re-checking the same period
    await RedisService.setLastCheckedTime(username, untilTime);
  }

  return allTweets;
}

function formatDateForTwitter(date: Date): string {
  // Format: YYYY-MM-DD_HH:MM:SS_UTC
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}_${hours}:${minutes}:${seconds}_UTC`;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// // Main monitoring loop
// async function main(): Promise<void> {
//   console.log(`Starting to monitor tweets from @${TARGET_ACCOUNT}`);
//   console.log(`Checking every ${CHECK_INTERVAL} seconds`);

//   try {
//     while (true) {
//       await checkForNewTweets("danielezet");
//       await sleep(CHECK_INTERVAL);
//     }
//   } catch (error) {
//     if (error instanceof Error && error.name === "SIGINT") {
//       console.log("Monitoring stopped.");
//     } else {
//       console.log("Monitoring stopped due to error:", error);
//     }
//   }
// }

// main().catch(console.error);
