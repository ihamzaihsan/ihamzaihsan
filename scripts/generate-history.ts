import { mkdir, writeFile } from "node:fs/promises";
import { getBestRoute } from "@snk/solver/getBestRoute";
import { getPathToPose } from "@snk/solver/getPathToPose";
import { snake4 } from "@snk/types/__fixtures__/snake";
import { createSvg } from "@snk/svg-creator";
import { cellsToGrid } from "./packages/generate-snake-animation/cellsToGrid";
import { palettes } from "./packages/generate-snake-animation/palettes";

const username = process.env.GITHUB_USER || "ihamzaihsan";
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");
const now = new Date();
const today = now.toISOString().slice(0, 10);
const currentYear = now.getUTCFullYear();
const out = "../assets";
await mkdir(out, { recursive: true });

async function query(q: string, variables: Record<string, unknown> = {}) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, variables: { login: username, ...variables } }),
  });
  const result = await response.json();
  if (!response.ok || result.errors) throw new Error(JSON.stringify(result.errors || result));
  if (!result.data.user) throw new Error("GitHub user was not found");
  return result.data.user;
}
const user = await query(`query($login:String!){
  user(login:$login){createdAt contributionsCollection{contributionYears}}
}`);
const years: number[] = [...new Set<number>([
  ...user.contributionsCollection.contributionYears,
  ...Array.from({length: Math.max(0, currentYear - 2024 + 1)}, (_, i) => 2024 + i),
])].filter(y => y <= currentYear).sort();
const daily = new Map<string, number>();
for (const year of years) {
  const user = await query(`query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){contributionsCollection(from:$from,to:$to){
      contributionCalendar{weeks{contributionDays{date contributionCount}}}
    }}
  }`, {
    from: `${year}-01-01T00:00:00Z`,
    to: year === currentYear ? now.toISOString() : `${year}-12-31T23:59:59Z`,
  });
  for (const week of user.contributionsCollection.contributionCalendar.weeks) {
    for (const day of week.contributionDays) {
      if (day.date.startsWith(String(year)) && day.date <= today) {
        daily.set(day.date, day.contributionCount);
      }
    }
  }
}

// Fold the same calendar dates into a single 53-column grid.
// A leap reference year retains February 29 without shifting later dates.
const sums = Array(371).fill(0);
for (const [date, count] of daily) {
  const index = Math.round((Date.parse("2000" + date.slice(4) + "T00:00:00Z") - Date.UTC(2000, 0, 1)) / 86400000);
  sums[index] += count;
}
const positive = sums.filter(n => n > 0).sort((a, b) => a - b);
const thresholds = [0.25, 0.5, 0.75].map(q => positive[Math.min(positive.length - 1, Math.floor(positive.length * q))] || 0);
const cells = sums.map((count, i) => ({
  x: Math.floor(i / 7), y: i % 7,
  level: count ? 1 + thresholds.filter(t => count > t).length : 0,
}));
const grid = cellsToGrid(cells);
const chain = getBestRoute(grid, snake4);
if (!chain?.length) throw new Error("Snake route could not be generated");
const home = getPathToPose(chain[chain.length - 1], snake4);
if (!home) throw new Error("Snake route could not be closed");
chain.push(...home);
for (const theme of ["light", "dark"] as const) {
  const palette = palettes[`github-${theme}`];
  const svg = createSvg(grid, cells, chain, {
    ...palette, sizeCell: 16, sizeDot: 12, sizeDotBorderRadius: 2,
  } as any, { stepDurationMs: 70 });
  await writeFile(`${out}/snake-all-years-${theme}.svg`, svg);
}

// Monthly contribution totals from January 2024 through today.
const months: string[] = [];
for (let year = 2024; year <= currentYear; year++) {
  const lastMonth = year === currentYear ? now.getUTCMonth() + 1 : 12;
  for (let month = 1; month <= lastMonth; month++) months.push(`${year}-${String(month).padStart(2, "0")}`);
}
const monthly = new Map(months.map(month => [month, 0]));
const annual: Record<string, number> = {};
for (const [date, count] of daily) {
  annual[date.slice(0, 4)] = (annual[date.slice(0, 4)] || 0) + count;
  const month = date.slice(0, 7);
  if (monthly.has(month)) monthly.set(month, monthly.get(month)! + count);
}
const values = months.map(m => monthly.get(m)!);
const top = Math.max(1, ...values);
const x0 = 42, x1 = 748, y0 = 186, y1 = 60;
const points = values.map((n, i) => [x0 + i * (x1 - x0) / Math.max(1, values.length - 1), y0 - n / top * (y0 - y1)]);
const line = points.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
const ticks = months.map((m,i) => m.endsWith("-01") ? `<text x="${points[i][0]}" y="208" fill="#8b949e" font-size="11" text-anchor="middle">${m.slice(0,4)}</text>` : "").join("");
const total = values.reduce((a,b) => a+b, 0);
const monthName = new Intl.DateTimeFormat("en", {month:"short", timeZone:"UTC"}).format(now);
const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="790" height="238" viewBox="0 0 790 238" role="img" aria-label="GitHub contributions from January 2024 through ${today}">
<rect x="1" y="1" width="788" height="236" rx="10" fill="#0d1117" stroke="#30363d"/>
<g font-family="Arial,sans-serif">
<text x="24" y="30" fill="#c9d1d9" font-size="17" font-weight="bold">Contributions</text>
<text x="766" y="30" fill="#8b949e" text-anchor="end" font-size="12">Jan 2024 – ${monthName} ${currentYear}</text>
${[y0,(y0+y1)/2,y1].map(y=>`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#30363d"/>`).join("")}
<text x="32" y="${y1+4}" fill="#8b949e" text-anchor="end" font-size="10">${top}</text>
<text x="32" y="${y0+4}" fill="#8b949e" text-anchor="end" font-size="10">0</text>
<polygon points="${x0},${y0} ${line} ${x1},${y0}" fill="#238636" opacity=".17"/>
<polyline points="${line}" fill="none" stroke="#3fb950" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
${ticks}<text x="766" y="225" fill="#8b949e" text-anchor="end" font-size="12">${total.toLocaleString("en")} contributions</text>
</g></svg>`;
await writeFile(`${out}/contributions-since-2024.svg`, chart);
await writeFile(`${out}/history-summary.json`, JSON.stringify({
  username, generatedAt: now.toISOString(), snakeYears: years,
  yearlyContributions: annual, snakeTotal: sums.reduce((a,b)=>a+b,0),
  chartStart: "2024-01-01", chartEnd: today, chartTotal: total,
}, null, 2) + "\n");
console.log(JSON.stringify({ years, annual, chartTotal: total, routeFrames: chain.length }));
