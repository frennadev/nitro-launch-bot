import * as path from "path";
import { logger } from "./logger";

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

async function loadImageFromPath(imageName: string): Promise<any> {
  const imagePath = path.resolve(__dirname, "../../assets", imageName);
  logger.info(`Loading image from: ${imagePath}`);

  // Dynamic import of Canvas to avoid initialization issues in Docker
  const { loadImage } = await import("canvas");
  return await loadImage(imagePath);
}

function drawRoundedRect(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawAvatar(
  ctx: any,
  x: number,
  y: number,
  size: number,
  isProfit: boolean
) {
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  if (isProfit) {
    gradient.addColorStop(0, "rgba(0, 255, 132, 0.5)");
    gradient.addColorStop(1, "rgba(78, 205, 196, 0.5)");
  } else {
    gradient.addColorStop(0, "rgba(255, 107, 107, 0.5)");
    gradient.addColorStop(1, "rgba(255, 107, 107, 0.5)");
  }

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, 2 * Math.PI);
  ctx.fill();

  // Border
  ctx.strokeStyle = isProfit
    ? "rgba(0, 255, 132, 0.2)"
    : "rgba(255, 107, 107, 0.2)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawGlassBox(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number = 10
) {
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

export async function htmlToJpg(data: PnlData): Promise<Buffer> {
  const image = await generatePnlCardImage(data);
  return image;
}

// async function generatePnlCardImage(data: PnlData): Promise<Buffer> {
//   console.log("🎨 Generating PnL card with Canvas...");

//   try {
//     // Dynamic import of Canvas to avoid initialization issues in Docker
//     const { createCanvas } = await import("canvas");
//     const canvas = createCanvas(1366, 768);
//     const ctx = canvas.getContext("2d");

//     // Load images
//     const bgImage = await loadImageFromPath(
//       data.isProfit ? "bg2.png" : "red.png"
//     );
//     const catImage = await loadImageFromPath(
//       data.isProfit ? "cat.png" : "sad-cat.png"
//     );
//     const logoImage = await loadImageFromPath("logo.png");

//     // Draw background
//     ctx.drawImage(bgImage, 0, 0, 1366, 768);

//     // Draw logo
//     ctx.drawImage(logoImage, 60, 60, 60, 60);

//     // Draw username box
//     const usernameY = 150;
//     drawGlassBox(ctx, 60, usernameY, 280, 60, 15);

//     // Draw avatar
//     drawAvatar(ctx, 75, usernameY + 10, 40, data.isProfit);

//     // Draw username text
//     ctx.fillStyle = "#ffffff";
//     ctx.font = "600 18px 'Inter', sans-serif";
//     ctx.fillText("@Nitrosolanabot", 130, usernameY + 35);

//     // Draw token name box
//     const tokenY = usernameY + 90;
//     drawRoundedRect(ctx, 60, tokenY, 300, 60, 12);
//     const tokenGradient = ctx.createLinearGradient(
//       60,
//       tokenY,
//       360,
//       tokenY + 60
//     );
//     tokenGradient.addColorStop(0, "rgba(34, 34, 34, 0.8)");
//     tokenGradient.addColorStop(
//       1,
//       data.isProfit ? "rgba(0, 255, 132, 0.1)" : "rgba(255, 107, 107, 0.1)"
//     );
//     ctx.fillStyle = tokenGradient;
//     ctx.fill();
//     ctx.strokeStyle = data.isProfit
//       ? "rgba(0, 255, 132, 0.3)"
//       : "rgba(255, 107, 107, 0.3)";
//     ctx.lineWidth = 1;
//     ctx.stroke();

//     // Draw token symbol
//     ctx.fillStyle = data.isProfit ? "#00ff84" : "#ff6b6b";
//     ctx.font = "700 22px 'Inter', sans-serif";
//     ctx.fillText(`$${data.tokenSymbol.toUpperCase()}`, 85, tokenY + 40);

//     // Draw ROI percentage
//     const roiY = tokenY + 100;
//     const roiText = `${data.isProfit ? "+" : "-"}${Math.abs(data.roi).toFixed(1)}%`;

//     // Create gradient for ROI text
//     const roiGradient = ctx.createLinearGradient(60, roiY, 400, roiY + 100);
//     if (data.isProfit) {
//       roiGradient.addColorStop(0, "#00ff84");
//       roiGradient.addColorStop(0.5, "#4ecdc4");
//       roiGradient.addColorStop(1, "#45b7d1");
//     } else {
//       roiGradient.addColorStop(0, "#ff6b6b");
//       roiGradient.addColorStop(0.5, "#da3737");
//       roiGradient.addColorStop(1, "#990404");
//     }
//     ctx.fillStyle = roiGradient;
//     ctx.font = "900 96px 'Inter', sans-serif";
//     ctx.fillText(roiText, 60, roiY + 80);

//     // Draw metrics
//     const metricsY = roiY + 130;
//     const metrics = [
//       `Sol Worth: $${data.entryPrice.toFixed(3)} SOL`,
//       `Current Price: $${data.currentPrice.toFixed(6)}`,
//     ];

//     metrics.forEach((metric, index) => {
//       const metricY = metricsY + index * 65;
//       drawGlassBox(ctx, 60, metricY, 400, 50, 10);

//       ctx.fillStyle = "#ffffff";
//       ctx.font = "500 18px 'Inter', sans-serif";
//       const parts = metric.split(": ");
//       ctx.fillText(parts[0] + ": ", 80, metricY + 32);

//       const labelWidth = ctx.measureText(parts[0] + ": ").width;
//       ctx.fillStyle = data.isProfit ? "#00ff84" : "#da3737";
//       ctx.font = "700 18px 'Inter', sans-serif";
//       ctx.fillText(parts[1], 80 + labelWidth, metricY + 32);
//     });

//     // Draw note box
//     const noteY = metricsY + 150;
//     drawRoundedRect(ctx, 60, noteY, 500, 90, 12);
//     ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
//     ctx.fill();
//     ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
//     ctx.lineWidth = 1;
//     ctx.stroke();

//     // Draw left border
//     ctx.fillStyle = data.isProfit ? "#00ff84" : "#da3737";
//     ctx.fillRect(60, noteY, 4, 90);

//     // Draw note text
//     ctx.fillStyle = "#b0b0b0";
//     ctx.font = "400 15px 'Inter', sans-serif";
//     const noteLines = [
//       "Make more money trading with NitroBOT. Solana's fastest",
//       " telegram bot. Better luck next time!",
//     ];

//     noteLines.forEach((line, index) => {
//       ctx.fillText(line, 85, noteY + 30 + index * 25);
//     });

//     // Draw cat image
//     const catSize = 740;
//     const catHeight = 600;
//     ctx.drawImage(catImage, 850, 250, catSize, catHeight);

//     console.log("✅ PnL card generated successfully!");
//     return canvas.toBuffer("image/jpeg", { quality: 1.0 });
//   } catch (error) {
//     console.error("❌ Error generating PnL card:", error);
//     throw error;
//   }
// }

async function generatePnlCardImage(data: PnlData): Promise<Buffer> {
  // const data: PnlData = {
  //   currentPrice: 0.2382,
  //   entryPrice: 0.2,
  //   isProfit: true,
  //   marketCap: "1,000,000",
  //   pnlValue: 80.7,
  //   openedTime: "2023-10-01T12:00:00Z",
  //   positionSize: "3.00",
  //   roi: 2590.0, // ((80.7 - 3) / 3) * 100 = 2590%
  //   tokenName: "MOMO",
  //   tokenSymbol: "MOMO",
  //   positionType: "LONG",
  //   username: "Sydneyeths",
  // };
  console.log("🎨 Generating PnL card...");

  const { createCanvas, registerFont } = await import("canvas");
  const canvas = createCanvas(2561, 1440);
  const ctx = canvas.getContext("2d");

  // Register fonts (assume paths are correct)
  registerFont(path.resolve(__dirname, "../../assets/fonts/minasans.otf"), {
    family: "Minasans",
  });
  registerFont(
    path.resolve(__dirname, "../../assets/fonts/BrunoAce-Regular.ttf"),
    {
      family: "Bruno Ace",
    }
  );
  registerFont(
    path.resolve(__dirname, "../../assets/fonts/Poppins-Regular.ttf"),
    {
      family: "Poppins",
    }
  );

  // Load static background and QR

  const bgPath = "pnl" + (data.isProfit ? "Profit" : "Loss");
  const folderPath = data.isProfit ? "profit" : "loss";
  const profitBgsLength = 7;
  const lossBgsLength = 4;
  const bgCount = data.isProfit ? profitBgsLength : lossBgsLength;
  let bgIndex = Math.floor(Math.random() * bgCount) + 1;
  if (bgIndex > bgCount) {
    bgIndex = 1; // Reset to 1 if index exceeds available backgrounds
  }
  const bgFileName = `backgrounds/${folderPath}/${bgPath}${bgIndex}.png`;

  const bgImage = await loadImageFromPath(bgFileName);
  const qrImage = await loadImageFromPath("qr.png");
  const xImage = await loadImageFromPath("icons/x.png");
  const globeImage = await loadImageFromPath("icons/globe.png");

  // Draw full background
  ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

  // === TEXTS ===

  // Nitrobot top-left (beside logo)
  ctx.font = "50px Minasans";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("NITROLAUNCH", 390, 210); // Adjust X if logo is smaller

  // Username top-right
  ctx.font = "50px Minasans";
  const usernameText = `@${data.username}`;
  const textWidth = ctx.measureText(usernameText).width;
  const fixedRightX = canvas.width - 230; // Fixed right margin
  const usernameX = fixedRightX - textWidth;
  ctx.fillText(usernameText, usernameX, 210);

  // $TICKER
  ctx.font = "60px Poppins";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`$${data.tokenSymbol.toUpperCase()}`, 1150, 450);

  // ROI % — big number
  ctx.font = "160px 'Bruno Ace'";
  ctx.fillStyle = data.isProfit ? "#3fff86" : "#ff3f3f";
  ctx.fillText(
    `${data.isProfit ? "+" : "-"}${data.roi.toFixed(1)}%`,
    1150,
    650
  );

  // Bought / Sold headers
  ctx.font = "50px Poppins";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("BOUGHT", 1150, 830);
  ctx.fillText("WORTH", 1600, 830);

  // Sol values
  ctx.font = "70px 'Bruno Ace'";
  ctx.fillText(`${parseFloat(data.positionSize)}`, 1150, 920);
  ctx.fillText(`${parseFloat(data.pnlValue.toFixed(2))} SOL`, 1600, 920);

  // // Dotted line
  // ctx.setLineDash([20, 15]);
  // ctx.beginPath();
  // ctx.moveTo(200, 1000);
  // ctx.lineTo(canvas.width - 200, 1000);
  // ctx.strokeStyle = "#FFFFFF";
  // ctx.lineWidth = 2;
  // ctx.stroke();
  // ctx.setLineDash([]);

  // === BOTTOM SECTION ===

  // QR Code
  ctx.drawImage(qrImage, 250, 1130, 170, 170);
  ctx.drawImage(globeImage, canvas.width - 550, 1160, 50, 50);
  ctx.drawImage(xImage, canvas.width - 550, 1230, 50, 50);

  // Info Text
  ctx.font = "36px Poppins";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("Make more money trading with NitroLaunch.", 450, 1180);
  ctx.fillText("Solana's fastest telegram bot.", 450, 1230);
  ctx.fillText("Better luck next time!", 450, 1280);

  // Links
  ctx.font = "44px Poppins";
  ctx.fillText("nitrobot.io", canvas.width - 490, 1200);
  ctx.fillText("@Nitrob0t_io", canvas.width - 490, 1260);

  return canvas.toBuffer("image/png");
}
