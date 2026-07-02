import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";

await rm(".vercel/output", { recursive: true, force: true });
await mkdir(".vercel/output/static/assets", { recursive: true });

await copyFile("src/landing.html", ".vercel/output/static/index.html");
await copyFile("assets/ragship-mascot.svg", ".vercel/output/static/assets/ragship-mascot.svg");

await writeFile(".vercel/output/config.json", JSON.stringify({ version: 3 }));
