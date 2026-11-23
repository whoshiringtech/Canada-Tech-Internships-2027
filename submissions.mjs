// Reader submissions, handled through GitHub issues.
//
//   node submissions.mjs apply   (before build.mjs) reads approved issues, updates state.json,
//                                and writes replies.json with what to tell each issue
//   node submissions.mjs reply   (after the commit is pushed) comments on and closes those issues
//
// How Brandon uses it:
// - "Add a job" form (label "add job"): check it, then add the label "approved". The job goes on
//   the list and the issue is closed with a comment showing exactly what was added.
// - "Report a closed job" form (label "closed job"): check it, then add "approved". The job is
//   marked Closed.
// - Undo: add the label "remove" to an add-job issue (even a closed one). Its job comes off the list.
//
// Issue text is written by strangers: it's only ever read here as data, checked field by field,
// and only acted on when someone with write access to the repo added the label.
import fs from "node:fs/promises";

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const STATE = "state.json";
const REPLIES = "replies.json";

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "canada-tech-internships submissions",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${opts.method || "GET"} ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// Issue forms come out as "### Label\n\nvalue" blocks.
export function parseForm(body = "") {
  const out = {};
  const parts = String(body).split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const label = (nl < 0 ? p : p.slice(0, nl)).trim().toLowerCase();
    const value = (nl < 0 ? "" : p.slice(nl + 1)).trim();
    out[label] = value === "_No response_" ? "" : value;
  }
  return out;
}

// For bot comments: plain text inside a code span, so nothing becomes a link, mention or markup.
const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";

const clean = (s, max) => String(s || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function httpsUrl(s) {
  try {
    const u = new URL(String(s || "").trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

const LEVELS = { "internship or co-op": "internship", "new grad or entry level": "entry" };
const CATEGORY = { "software engineering": "software", "data science, ai & machine learning": "data-ai", "cloud & devops": "cloud-devops", security: "security", "qa & testing": "qa", "it & support": "it-support", "product & program": "product", "hardware & embedded": "hardware", "other tech": "other" };
const REMOTE = { "no, in person or hybrid": 0, "remote ok": 1, "fully remote (canada)": 2 };

// Returns { job } or { error }. Row format matches build.mjs:
// [title, company, companySlug, country, city, remote, level, field, url, day]
export function jobFromForm(f, day) {
  const company = clean(f["company"], 100);
  const title = clean(f["job title"], 200);
  const level = LEVELS[clean(f["level"], 50).toLowerCase()];
  const remoteKind = REMOTE[clean(f["remote?"], 50).toLowerCase()];
  let city = clean(f["city"], 60);
  const url = httpsUrl(f["apply link"]);
  if (!company || !title) return { error: "the company or job title is missing" };
  if (!level) return { error: "the level isn't one of the form's choices" };
  if (remoteKind === undefined) return { error: "the Remote? answer isn't one of the form's choices" };
  if (!city && remoteKind !== 2) return { error: "the city is missing" };
  if (!url) return { error: "the apply link isn't a valid https:// link" };
  const field = CATEGORY[clean(f["category"], 60).toLowerCase()] || "other";
  if (/linkedin\.com|indeed\.(com|ca)/i.test(new URL(url).host)) return { error: "LinkedIn and Indeed links aren't accepted; please use the employer's own site" };
  if (remoteKind === 2) city = "Remote";
  return { job: [title, company, "", "CA", city, remoteKind === 1 ? 1 : 0, level, field, url, day] };
}

async function approvedBy(issue, label) {
  // Who added the label most recently, and can they write to the repo?
  const events = await gh(`/issues/${issue}/events?per_page=100`);
  const ev = events.filter((e) => e.event === "labeled" && e.label?.name === label).pop();
  if (!ev?.actor?.login) return false;
  const p = await gh(`/collaborators/${encodeURIComponent(ev.actor.login)}/permission`).catch(() => null);
  return ["admin", "maintain", "write"].includes(p?.permission);
}

async function listIssues(label, stateFilter) {
  return (await gh(`/issues?labels=${encodeURIComponent(label)}&state=${stateFilter}&per_page=100`)).filter((i) => !i.pull_request);
}

async function apply() {
  const state = JSON.parse(await fs.readFile(STATE, "utf8").catch(() => "{}"));
  const replies = [];
  const day = Math.floor(Date.now() / 864e5);
  const has = (i, name) => i.labels.some((l) => l.name === name);

  for (const issue of await listIssues("approved", "open")) {
    const n = issue.number;
    if (!(await approvedBy(n, "approved"))) {
      replies.push({ n, close: false, unlabel: "approved", text: "The approved label can only be added by the list's maintainers, so nothing was changed." });
      continue;
    }
    const f = parseForm(issue.body);
    if (has(issue, "add job")) {
      const r = jobFromForm(f, day);
      if (r.error) { replies.push({ n, close: false, unlabel: "approved", text: `Couldn't add this job: ${r.error}. Edit the issue to fix it, and we'll take another look.` }); continue; }
      const url = r.job[8];
      if (state[url]) { replies.push({ n, close: true, text: "Thanks! This job is already on the list." }); continue; }
      state[url] = { job: r.job, submitted: true, issue: n, missing: 0, closedAt: null };
      const [title, company, , , city, remote, level] = r.job;
      replies.push({ n, close: true, text: `Added to the list, thanks!\n\n- Company: ${code(company)}\n- Job: ${code(title)}\n- Where: ${code(city + (remote ? " (remote OK)" : ""))}\n- Level: ${level === "internship" ? "Internship or co-op" : "New grad or entry level"}\n- Link: ${code(url)}` });
    } else if (has(issue, "closed job")) {
      const url = httpsUrl(f["apply link of the job"]);
      const st = url && state[url];
      if (!st) { replies.push({ n, close: false, unlabel: "approved", text: "Couldn't find a job on the list with that exact link. Please paste the link from the job's Apply button." }); continue; }
      if (!st.closedAt) st.closedAt = Date.now();
      replies.push({ n, close: true, text: `Thanks! Marked as closed: ${code(st.job[1] + ", " + st.job[0])}.` });
    } else {
      replies.push({ n, close: false, unlabel: "approved", text: "This issue isn't an Add a job or Report a closed job form, so nothing was changed." });
    }
  }

  for (const issue of await listIssues("remove", "all")) {
    const n = issue.number;
    if (!(await approvedBy(n, "remove"))) { replies.push({ n, close: false, unlabel: "remove", text: "Only the list's maintainers can remove jobs, so nothing was changed." }); continue; }
    let removed = 0;
    for (const [url, st] of Object.entries(state)) if (st.submitted && st.issue === n) { delete state[url]; removed++; }
    replies.push({ n, close: true, unlabel: "remove", text: removed ? "Removed this job from the list." : "There was no job from this issue on the list." });
  }

  await fs.writeFile(STATE, JSON.stringify(state));
  await fs.writeFile(REPLIES, JSON.stringify(replies));
  console.log(`Submissions: ${replies.length} issue(s) handled`);
}

async function reply() {
  const replies = JSON.parse(await fs.readFile(REPLIES, "utf8").catch(() => "[]"));
  for (const r of replies) {
    await gh(`/issues/${r.n}/comments`, { method: "POST", body: JSON.stringify({ body: r.text }) });
    if (r.unlabel) await gh(`/issues/${r.n}/labels/${encodeURIComponent(r.unlabel)}`, { method: "DELETE" }).catch(() => {});
    if (r.close) await gh(`/issues/${r.n}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  }
}

const cmd = process.argv[2];
if (cmd === "apply") await apply();
else if (cmd === "reply") await reply();
