import { buyHeavenUngraduated } from "./heaven-buy";

async function main() {
  const token = process.env.HEAVEN_TOKEN || "8KebtdAbHA5kA96VsJTZssAYNA1CHoWYonwB9hn1p777";
  const pk = process.env.HEAVEN_PK;
  const sol = Number(process.env.HEAVEN_SOL || "0.001");
  if (!pk) {
    console.error("Set HEAVEN_PK (base58 secret key)");
    process.exit(1);
  }
  const sig = await buyHeavenUngraduated(token, pk, sol);
  console.log("Signature:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

