// Builds README.md from Who's Hiring's live job data (Canadian internships, co-ops and new grad jobs).
// Runs every morning in GitHub Actions after whoshiringtech.com refreshes.
import fs from "node:fs/promises";

const SITE = "https://whoshiringtech.com";
const res = await fetch(`${SITE}/data/jobs.json`, { headers: { "User-Agent": "canada-tech-internships list builder" } });
if (!res.ok) throw new Error(`jobs.json ${res.status}`);
const { jobs, built } = await res.json();
if (!Array.isArray(jobs)) throw new Error("jobs.json has no job list");

// Heads-up for next year's list: Canadian internship / new grad jobs that mention 2028.
// The workflow opens one GitHub issue the first time any show up (time to start the 2028 repo).
const next = jobs.filter((j) => j[3] === "CA" && (j[6] === "internship" || j[6] === "entry") && /\b2028\b/.test(j[0]));
if (process.env.GITHUB_OUTPUT) {
  // Titles come from outside sites: strip line breaks so they can't break the output format.
  const list = next.slice(0, 20).map((j) => `- ${j[1]}: ${j[0]}`.replace(/[\r\n]+/g, " ")).join("\n");
  await fs.appendFile(process.env.GITHUB_OUTPUT, `count2028=${next.length}\nlist2028<<EOF_2028\n${list}\nEOF_2028\n`);
}
console.log(`Jobs mentioning 2028: ${next.length}`);

// Memory of jobs shown before (state.json), so a job that disappears can be shown as Closed.
// A job counts as closed after it is missing from 2 refreshes in a row (one failed company
// board shouldn't mark its jobs closed). Nothing is ever removed: this repo is the record of
// every job that appeared this cycle (a new repo starts for the next year).
const STATE = "state.json";
const state = JSON.parse(await fs.readFile(STATE, "utf8").catch(() => "{}"));
const now = Date.now();
const live = new Map();
for (const j of jobs) if (j[3] === "CA" && (j[6] === "internship" || j[6] === "entry")) live.set(j[8], j);
// Safety check: if the site suddenly returns far fewer jobs (a broken refresh), don't mark
// everything closed. Leave the list as it is until the next run.
const wasOpen = Object.values(state).filter((st) => !st.closedAt && !st.submitted).length;
if (wasOpen >= 40 && live.size < wasOpen * 0.4) {
  console.log(`Only ${live.size} jobs now vs ${wasOpen} before; looks like a bad refresh, not updating.`);
  process.exit(0);
}
// The site's feed refreshes twice a day but this list builds more often (and on approvals), so a
// job only counts as missing once per new feed. meta.json remembers which feed was counted last.
const META = "meta.json";
const meta = JSON.parse(await fs.readFile(META, "utf8").catch(() => "{}"));
const newFeed = !built || built !== meta.feedBuilt;
for (const [url, j] of live) state[url] = { job: j, missing: 0, closedAt: null };
for (const [url, st] of Object.entries(state)) {
  if (live.has(url)) continue;
  if (st.closedAt) continue;
  // The site stops listing jobs older than 90 days. We can't tell if those closed,
  // so they're marked "Archived" instead of "Closed" and stay on the list.
  if (Math.floor(now / 864e5) - st.job[9] > 90) { st.closedAt = now; st.archived = true; continue; }
  // Jobs readers submitted aren't in the feed; they close only when someone reports them.
  if (st.submitted || !newFeed) continue;
  st.missing++;
  if (st.missing >= 2) st.closedAt = now;
}
await fs.writeFile(STATE, JSON.stringify(state));
await fs.writeFile(META, JSON.stringify({ feedBuilt: built || null }));

// Row: [title, company, companySlug, country, city, remote, level, field, url, day]
const today = Math.floor(Date.now() / 864e5);
// Job titles and company names come from outside sites, so treat them as plain text:
// escape every character that Markdown or HTML could turn into a link, image or tag.
const cell = (s) =>
  String(s ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b(https?:\/\/|www\.)\S*/gi, "") // no web addresses (GitHub would make them clickable)
    .slice(0, 200)
    .replace(/[\\`*_{}[\]()<>#!|~]/g, (c) => "\\" + c)
    .trim();
// Only plain https links to the employer; anything else gets no Apply link.
const safeUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.href.replace(/[()<>]/g, (c) => encodeURIComponent(c)) : null;
  } catch {
    return null;
  }
};
const safeSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, "");
// How long ago a job was posted: "Today", "12d", then months ("3mo"), then years ("1yr 2mo").
const age = (d) => {
  const n = today - d;
  if (n <= 0) return "Today";
  if (n < 30) return `${n}d`;
  if (n < 365) return `${Math.floor(n / 30)}mo`;
  const y = Math.floor(n / 365);
  const m = Math.floor((n - y * 365) / 30);
  return m ? `${y}yr ${m}mo` : `${y}yr`;
};
const where = (city, remote) => (city === "Remote" ? "Remote (Canada)" : `${city}${remote ? " (remote OK)" : ""}`);

// Job categories, same as whoshiringtech.com's fields. Jobs with no field go under Other.
const CATEGORIES = [
  ["software", "💻", "Software Engineering"],
  ["data-ai", "🤖", "Data Science, AI & Machine Learning"],
  ["cloud-devops", "☁️", "Cloud & DevOps"],
  ["security", "🔐", "Security"],
  ["qa", "🧪", "QA & Testing"],
  ["it-support", "🛠️", "IT & Support"],
  ["product", "📱", "Product & Program"],
  ["hardware", "🔧", "Hardware & Embedded"],
  ["other", "🧩", "Other Tech"],
];
const fieldOf = (st) => (CATEGORIES.some(([k]) => k === st.job[7]) ? st.job[7] : "other");

function row(st) {
  const [title, company, slug, , city, remote, , , url, day] = st.job;
  const link = safeUrl(url);
  const apply = st.archived ? "📦 Archived" : st.closedAt ? "🚧 Closed" : link ? `[Apply](${link})` : "";
  // Submitted jobs have no company page on the site, so their company is plain text.
  const co = slug ? `[${cell(company)}](${SITE}/company/${safeSlug(slug)}/)` : cell(company);
  return `| ${co} | ${cell(title)} | ${cell(where(city, remote))} | ${age(day)} | ${apply} |`;
}

// One section per level, split into a table per category (biggest first, Other last).
// Each table has a fixed anchor (<a name>) so the Browse links keep working as counts change.
function section(level, prefix) {
  const all = Object.values(state).filter((st) => st.job[6] === level);
  const open = all.filter((st) => !st.closedAt).length;
  const groups = CATEGORIES.map(([key, icon, label]) => {
    const jobs = all.filter((st) => fieldOf(st) === key);
    return { key, icon, label, jobs, open: jobs.filter((st) => !st.closedAt).length, anchor: `${prefix}-${key}` };
  })
    .filter((g) => g.jobs.length)
    .sort((a, b) => (a.key === "other") - (b.key === "other") || b.open - a.open);
  const browse = groups.map((g) => `- ${g.icon} [${g.label}](#${g.anchor}) (${g.open})`).join("\n");
  const tables = groups
    .map((g) => {
      // Closed jobs keep their spot in date order (newest first); only the Apply cell changes.
      const rows = [...g.jobs].sort((a, b) => b.job[9] - a.job[9]).map(row);
      return [`<a name="${g.anchor}"></a>`, `### ${g.icon} ${g.label} (${g.open})`, "", "| Company | Role | Location | Posted | Apply |", "|---|---|---|---|---|", ...rows].join("\n");
    })
    .join("\n\n");
  return { n: open, browse, tables };
}

const intern = section("internship", "intern");
const entry = section("entry", "newgrad");
const date = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });

const md = `# Canadian Tech Internships, Co-ops and New Grad Jobs (2026-2027)

Every open software, data, cloud, security, QA and IT internship and entry-level job in Canada that we can find, pulled straight from company career pages, plus jobs readers send in (we check each one). Updated every 6 hours.

**${intern.n} internships and co-ops** and **${entry.n} new grad and entry-level jobs** as of ${date}.

- Search all of them, plus US and remote jobs, at **[whoshiringtech.com](${SITE})**
- Get new matches by email every Monday, free: **[job alerts](${SITE}/alerts/)**
- Click a company name to see all of its tech jobs. "Apply" goes straight to the employer.
- Know a job that's missing? **[Add a job](../../issues/new?template=add-job.yml)**. Found a closed one? **[Report it](../../issues/new?template=report-closed.yml)**.

Star this repo to keep it handy. 🚧 **Closed** means the employer took the job down; 📦 **Archived** means the job was posted more than 90 days ago and may be closed. Nothing is ever removed, so this list is a full record of every job that appeared.

## Browse ${intern.n} internships and co-ops by category

${intern.browse}

## Browse ${entry.n} new grad and entry-level jobs by category

${entry.browse}

## Internships and co-ops

${intern.tables}

## New grad and entry level

${entry.tables}

---

Built by [Who's Hiring](${SITE}). Jobs are collected from each company's own public job board (Greenhouse, Lever, Ashby and others). Spotted a mistake? [Open an issue](../../issues).
`;
await fs.writeFile("README.md", md);
console.log(`README: ${intern.n} internships, ${entry.n} entry level`);
