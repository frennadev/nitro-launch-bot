import * as path from "path";
import { logger } from "./logger";
import { Image } from "canvas";

export interface PnlData {
  tokenSymbol: string;
  tokenName: string;
  positionType: "LONG" | "SHORT";
  pnlValue: number;
  roi: number;
  entryPrice: number;
  currentPrice: number;
  positionSize: string;
  marketCap: string;
  openedTime: string;
  username: string;
  isProfit: boolean;
}

async function loadImageFromPath(imageName: string): Promise<Image> {
  const imagePath = path.resolve(__dirname, "../../assets", imageName);
  logger.info(`Loading image from: ${imagePath}`);

  // Dynamic import of Canvas to avoid initialization issues in Docker
  const { loadImage } = await import("canvas");
  return await loadImage(imagePath);
}
export interface LaunchCardData {
  ticker: string;
  percentGain: string;
  investedToken: string;
  investedUsd: string;
  returnsToken: string;
  returnsUsd: string;
  deployedOn: Date;
  isProfit: boolean;
}

export async function htmlToJpg(data: LaunchCardData): Promise<Buffer> {
  const image = await generatePNLCard(data);
  return image;
}

async function generatePNLCard(data: LaunchCardData): Promise<Buffer> {
  const { createCanvas, registerFont } = await import("canvas");

  // Register Canva Sans font
  registerFont(path.resolve(__dirname, "../../assets/fonts/CanvaSans.otf"), {
    family: "Canva Sans",
  });
  registerFont(
    path.resolve(__dirname, "../../assets/fonts/BrunoAce-Regular.ttf"),
    {
      family: "Bruno Ace",
    }
  );
  const deployedOnText = data.deployedOn.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });

  const bg = await loadImageFromPath("./launchBg.png"); // base template
  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext("2d");

  // draw background
  ctx.drawImage(bg, 0, 0, bg.width, bg.height);

  // ---- TEXT ----
  ctx.textAlign = "left";

  // Ticker
  ctx.fillStyle = "#FFFFFF";
  // ctx.font = "80px 'Canva Sans'";
  ctx.font = "80px 'Bruno Ace'";

  ctx.fillText(`$${data.ticker}`, 100, 400);

  // Percent gain
  ctx.fillStyle = data.isProfit ? "#53FF88" : "#FF5353";
  ctx.font = "55px 'Canva Sans'";
  ctx.fillText(`${data.isProfit ? "+" : "-"} ${data.percentGain}`, 550, 390);

  // Invested
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "70px 'Bruno ace'";
  ctx.fillText(data.investedToken, 270, 677);

  ctx.fillStyle = "#BABABA";
  ctx.font = "38px 'Canva Sans'";
  ctx.fillText(data.investedUsd + " USD", 169, 745);

  // Returns
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "70px 'Bruno Ace'";
  ctx.fillText(data.returnsToken, 858, 677);

  ctx.fillStyle = "#BABABA";
  ctx.font = "38px 'Canva Sans'";
  ctx.fillText(data.returnsUsd + " USD", 757, 745);

  // Date
  ctx.fillStyle = "#BABABA";
  ctx.font = "38px 'Canva Sans'";
  ctx.fillText(`DEPLOYED ON : ${deployedOnText}`, 169, 865);

  const qrImg = await loadImageFromPath("qr.png");

  // ctx.drawImage(qrImg, 50, 560, 100, 100); // adjust x, y, size
  ctx.drawImage(qrImg, 100, 970, 150, 150);

  return canvas.toBuffer("image/png");
}
