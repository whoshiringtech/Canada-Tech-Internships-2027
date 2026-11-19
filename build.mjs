// Builds README.md from Who's Hiring's live job data (Canadian internships, co-ops and new grad jobs).
// Runs every morning in GitHub Actions after whoshiringtech.com refreshes.
import fs from "node:fs/promises";

const SITE = "https://whoshiringtech.com";
const res = await fetch(`${SITE}/data/jobs.json`, { headers: { "User-Agent": "canada-tech-internships list builder" } });
if (!res.ok) throw new Error(`jobs.json ${res.status}`);
const { jobs } = await res.json();

// Memory of jobs shown before (state.json), so a job that disappears can be shown as Closed.
// A job counts as closed after it is missing from 2 refreshes in a row (one failed company
// board shouldn't mark its jobs closed). Closed jobs stay listed for 14 days, then drop off.
const STATE = "state.json";
const state = JSON.parse(await fs.readFile(STATE, "utf8").catch(() => "{}"));
const now = Date.now();
const live = new Map();
for (const j of jobs) if (j[3] === "CA" && (j[6] === "internship" || j[6] === "entry")) live.set(j[8], j);
for (const [url, j] of live) state[url] = { job: j, missing: 0, closedAt: null };
for (const [url, st] of Object.entries(state)) {
  if (live.has(url)) continue;
  // Jobs that aged out (older than 90 days) aren't "closed", they just leave the list.
  if (Math.floor(now / 864e5) - st.job[9] > 90) { delete state[url]; continue; }
  st.missing++;
  if (st.missing >= 2 && !st.closedAt) st.closedAt = now;
  if (st.closedAt && now - st.closedAt > 14 * 864e5) delete state[url];
}
await fs.writeFile(STATE, JSON.stringify(state));

// Row: [title, company, companySlug, country, city, remote, level, field, url, day]
const today = Math.floor(Date.now() / 864e5);
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/[\r\n]+/g, " ").trim();
const age = (d) => (today - d <= 0 ? "Today" : `${today - d}d`);
const where = (city, remote) => (city === "Remote" ? "Remote (Canada)" : `${city}${remote ? " (remote OK)" : ""}`);

function table(level) {
  const all = Object.values(state).filter((st) => st.job[6] === level);
  const open = all.filter((st) => !st.closedAt).sort((a, b) => b.job[9] - a.job[9]);
  const closed = all.filter((st) => st.closedAt).sort((a, b) => b.closedAt - a.closedAt);
  const row = (st) => {
    const [title, company, slug, , city, remote, , , url, day] = st.job;
    const apply = st.closedAt ? "🚧 Closed" : `[Apply](${url})`;
    const name = st.closedAt ? `~~${cell(title)}~~` : cell(title);
    return `| [${cell(company)}](${SITE}/company/${slug}/) | ${name} | ${cell(where(city, remote))} | ${age(day)} | ${apply} |`;
  };
  const rows = [...open, ...closed].map(row);
  return {
    n: open.length,
    md: ["| Company | Role | Location | Posted | Apply |", "|---|---|---|---|---|", ...rows].join("\n"),
  };
}

const intern = table("internship");
const entry = table("entry");
const date = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });

const md = `# Canadian Tech Internships, Co-ops and New Grad Jobs (2026-2027)

Every open software, data, cloud, security, QA and IT internship and entry-level job in Canada that we can find, pulled straight from company career pages. Updated every 6 hours.

**${intern.n} internships and co-ops** and **${entry.n} new grad and entry-level jobs** as of ${date}.

- Search all of them, plus US and remote jobs, at **[whoshiringtech.com](${SITE})**
- Get new matches by email every Monday, free: **[job alerts](${SITE}/alerts/)**
- Click a company name to see all of its tech jobs. "Apply" goes straight to the employer.

Star this repo to keep it handy. 🚧 **Closed** means the employer took the job down; closed jobs stay listed for 14 days so you know not to apply. Jobs older than 90 days are removed.

## Contents

- [Internships and co-ops](#internships-and-co-ops)
- [New grad and entry level](#new-grad-and-entry-level)

## Internships and co-ops

${intern.md}

## New grad and entry level

${entry.md}

---

Built by [Who's Hiring](${SITE}). Jobs are collected from each company's own public job board (Greenhouse, Lever, Ashby and others). Spotted a mistake or a closed job? [Open an issue](../../issues).
`;
await fs.writeFile("README.md", md);
console.log(`README: ${intern.n} internships, ${entry.n} entry level`);
