import fs from "node:fs";

const schedules = {
  daily: "0 8 * * *",
  "5m": "*/5 * * * *",
  "1m": "*/1 * * * *"
};

const choice = process.argv[2];
if (!schedules[choice]) {
  console.error(`Usage: node scripts/set-vercel-cron.js ${Object.keys(schedules).join("|")}`);
  process.exit(2);
}

const path = new URL("../vercel.json", import.meta.url);
const config = JSON.parse(fs.readFileSync(path, "utf8"));
config.crons = config.crons || [];
config.crons[0] = { path: "/api/cron", schedule: schedules[choice] };
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Set /api/cron schedule to ${choice}: ${schedules[choice]}`);
