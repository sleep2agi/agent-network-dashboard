#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");

const port = process.env.PORT || "3000";
// HOST is the dashboard/anet-facing override. HOSTNAME is often set by the OS
// to the machine name, so only use it when HOST is not provided.
const hostname = process.env.HOST || process.env.HOSTNAME || "127.0.0.1";
const dir = path.join(__dirname, "..");

console.log(`[dashboard] Starting on ${hostname}:${port}...`);
console.log(`[dashboard] Open http://localhost:${port}`);

const child = spawn(
  "npx",
  ["next", "start", "-p", port, "-H", hostname],
  {
    cwd: dir,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PORT: port, HOSTNAME: hostname },
  }
);

child.on("exit", (code) => process.exit(code || 0));
process.on("SIGINT", () => { child.kill(); process.exit(0); });
