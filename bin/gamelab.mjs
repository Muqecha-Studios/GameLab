#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main().catch((err) => {
    const code = err?.code && typeof err.code === "string" ? `${err.code}: ` : "";
    process.stderr.write(`gamelab: ${code}${err?.message ?? err}\n`);
    process.exit(err?.code === "usage" ? 2 : 1);
});
