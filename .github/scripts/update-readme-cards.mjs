// Self-contained cards from public GitHub REST data; no third-party services.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const owner = process.env.PROFILE_OWNER || 'SmallCoral';
if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner)) {
  throw new Error('PROFILE_OWNER must be a GitHub username');
}
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': `${owner}-profile-cards`,
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function api(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.github.com${path}`, {
      headers, signal: AbortSignal.timeout(30000),
    });
    if (response.ok) return response.json();
    if (response.status >= 500 && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
}

const user = await api(`/users/${owner}`);
const repos = [];
for (let page = 1; ; page++) {
  const batch = await api(`/users/${owner}/repos?type=owner&sort=full_name&per_page=100&page=${page}`);
  repos.push(...batch.filter(repo => !repo.fork && !repo.private && repo.owner.login.toLowerCase() === owner.toLowerCase()));
  if (batch.length < 100) break;
}

// Finish all API requests and validate the data before replacing good cards.
const totals = new Map();
for (const repo of repos) {
  const languages = await api(`/repos/${owner}/${encodeURIComponent(repo.name)}/languages`);
  for (const [language, bytes] of Object.entries(languages)) {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Invalid language byte count');
    totals.set(language, (totals.get(language) || 0) + bytes);
  }
}
const sorted = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const totalBytes = sorted.reduce((sum, [, bytes]) => sum + bytes, 0);
const top = sorted.slice(0, 5);
if (sorted.length > 5) top.push(['Other', sorted.slice(5).reduce((sum, [, bytes]) => sum + bytes, 0)]);
const updated = new Date().toISOString().slice(0, 10);
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);
const number = value => value.toLocaleString('en-US');

function card(title, description, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="230" viewBox="0 0 420 230" role="img" aria-labelledby="title desc">
  <title id="title">${escape(title)}</title>
  <desc id="desc">${escape(description)}</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #c9d1d9; }
    .heading { font-size: 18px; font-weight: 600; fill: #56d4dd; }
    .label { font-size: 12px; }
    .value { font-size: 27px; font-weight: 600; fill: #f0f6fc; }
    .muted { font-size: 11px; fill: #8b949e; }
  </style>
  <rect x=".5" y=".5" width="419" height="229" rx="8" fill="#0d1117" stroke="#30363d" />
  <text x="24" y="34" class="heading">${escape(title)}</text>
  ${body}
  <text x="24" y="212" class="muted">Public, non-fork repos · Updated ${updated} UTC</text>
</svg>\n`;
}

const metrics = [
  ['Repositories', repos.length],
  ['Stars earned', repos.reduce((sum, repo) => sum + repo.stargazers_count, 0)],
  ['Forks received', repos.reduce((sum, repo) => sum + repo.forks_count, 0)],
  ['Followers', user.followers],
];
if (metrics.some(([, value]) => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid profile metrics');
const statsBody = metrics.map(([label, value], index) => {
  const x = 24 + (index % 2) * 196;
  const y = 78 + Math.floor(index / 2) * 64;
  return `<text x="${x}" y="${y}" class="value">${number(value)}</text>
  <text x="${x}" y="${y + 20}" class="label">${label}</text>`;
}).join('\n  ');
const stats = card(`${owner}'s GitHub`, metrics.map(([label, value]) => `${label}: ${value}`).join('; '), statsBody);

const colors = ['#56d4dd', '#58a6ff', '#79c0ff', '#a5d8f3', '#b3ecf0', '#8b949e'];
let offset = 24;
const segments = top.map(([, bytes], index) => {
  const width = bytes / totalBytes * 372;
  const segment = `<rect x="${offset.toFixed(3)}" y="57" width="${width.toFixed(3)}" height="10" fill="${colors[index]}" />`;
  offset += width;
  return segment;
}).join('\n  ');
const languageLabels = top.map(([language, bytes], index) => {
  const x = 24 + (index % 2) * 196;
  const y = 98 + Math.floor(index / 2) * 31;
  return `<circle cx="${x + 4}" cy="${y - 4}" r="4" fill="${colors[index]}" />
  <text x="${x + 15}" y="${y}" class="label">${escape(language)}</text>
  <text x="${x + 175}" y="${y}" text-anchor="end" class="muted">${(bytes / totalBytes * 100).toFixed(1)}%</text>`;
}).join('\n  ');
const languages = card('Most Used Languages', `Code bytes across public non-fork repositories. ${top.map(([language, bytes]) => `${language}: ${bytes} bytes`).join('; ')}`,
  totalBytes ? `${segments}\n  ${languageLabels}\n  <text x="24" y="187" class="muted">By code bytes · Not a measure of proficiency</text>`
    : '<text x="24" y="100" class="label">No language data available yet.</text>');

const output = fileURLToPath(new URL('../../profile/', import.meta.url));
await mkdir(output, { recursive: true });
await writeFile(`${output}/stats.svg`, stats);
await writeFile(`${output}/top-langs.svg`, languages);
console.log(`Generated cards for ${owner}: ${repos.length} repositories, ${totals.size} languages.`);
