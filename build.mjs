// Builds README.md from Who's Hiring's live job data (Canadian internships, co-ops and new grad jobs).
// Runs every morning in GitHub Actions after whoshiringtech.com refreshes.
import fs from "node:fs/promises";

const SITE = "https://whoshiringtech.com";
const res = await fetch(`${SITE}/data/jobs.json`, { headers: { "User-Agent": "canada-tech-internships list builder" } });
if (!res.ok) throw new Error(`jobs.json ${res.status}`);
const { jobs } = await res.json();

// Row: [title, company, companySlug, country, city, remote, level, field, url, day]
const today = Math.floor(Date.now() / 864e5);
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/[\r\n]+/g, " ").trim();
const age = (d) => (today - d <= 0 ? "Today" : `${today - d}d`);
const where = (city, remote) => (city === "Remote" ? "Remote (Canada)" : `${city}${remote ? " (remote OK)" : ""}`);

function table(level) {
  const list = jobs.filter((j) => j[3] === "CA" && j[6] === level).sort((a, b) => b[9] - a[9]);
  const rows = list.map(([title, company, slug, , city, remote, , , url, day]) =>
    `| [${cell(company)}](${SITE}/company/${slug}/) | ${cell(title)} | ${cell(where(city, remote))} | ${age(day)} | [Apply](${url}) |`);
  return {
    n: list.length,
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

Star this repo to keep it handy. Jobs older than 90 days are removed.

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
