import { copyFile, mkdir, rm } from "node:fs/promises";

await rm(".vercel/output", { recursive: true, force: true });
await rm("site", { recursive: true, force: true });
await mkdir("site/assets", { recursive: true });

await copyFile("src/landing.html", "site/index.html");
await copyFile("assets/ragship-mascot.svg", "site/assets/ragship-mascot.svg");
