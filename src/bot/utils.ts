export function escape(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

export function formatUSD(amount: number): string {
  const absAmount = Math.abs(amount);
  let formatted: string;

  if (absAmount >= 1_000_000_000) {
    formatted = (amount / 1_000_000_000).toFixed(2).replace(/\.00$/, "") + "B";
  } else if (absAmount >= 1_000_000) {
    formatted = (amount / 1_000_000).toFixed(2).replace(/\.00$/, "") + "M";
  } else if (absAmount >= 1_000) {
    formatted = (amount / 1_000).toFixed(2).replace(/\.00$/, "") + "k";
  } else {
    formatted = amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
    return formatted;
  }

  return (amount < 0 ? "-" : "") + "$" + formatted;
}
