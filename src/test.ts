// details = upd.message.text.split(",").map((s) => s.trim());

// async function createToken() {
//   let details: string[];
//   const text =
//     "title, symbol, description, more details, and more, and more, and more";
//   const firstCommaIndex = text.indexOf(",");
//   const secondCommaIndex = text.indexOf(",", firstCommaIndex + 1);
//   if (firstCommaIndex !== -1 && secondCommaIndex !== -1) {
//     const name = text.substring(0, firstCommaIndex).trim();
//     const symbol = text.substring(firstCommaIndex + 1, secondCommaIndex).trim();
//     const description = text.substring(secondCommaIndex + 1).trim();
//     details = [name, symbol, description];
//   } else {
//     details = [];
//   }
//   console.log("Parsed details:", details);
//   if (details.length === 3) return details;
// }

// (async () => {
//   const details = await createToken();
//   console.log("Token details:", details);
// })();
