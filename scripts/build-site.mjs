import { readFile, writeFile, mkdir, copyFile, lstat, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "_site");
const catalog = JSON.parse(await readFile(path.join(root, "catalog.json"), "utf8"));
const approvedHosts = new Set([
  "learn.microsoft.com", "azure.microsoft.com", "revealjs.com",
  "news.microsoft.com", "techcommunity.microsoft.com", "devblogs.microsoft.com",
  "commandline.microsoft.com", "ai.azure.com"
]);
const approvedSamples = new Set([
  "https://github.com/microsoft-foundry/ignite-2026-demos/tree/main/foundry-and-a365"
]);
const slugs = new Set();

function checkPublicText(text, name) {
  if (/\u2014|&mdash;|&#(?:8212|x2014);/i.test(text)) {
    throw new Error(`Em dash found in ${name}.`);
  }
  if (/\b(?:UAT|MSX|vivalearn(?:ing)?)\b/i.test(text)) {
    throw new Error(`Non-customer terminology found in ${name}. Review before publication.`);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) {
    const url = new URL(match[0]);
    if (!approvedHosts.has(url.hostname) && !approvedSamples.has(url.href)) {
      throw new Error(`External host not approved for guide publication: ${url.hostname} in ${name}.`);
    }
  }
}

function checkString(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 500) {
    throw new Error(`Invalid ${field} in catalog.`);
  }
}

async function checkedFile(base, relative) {
  if (typeof relative !== "string" || relative.includes("\\") ||
      relative.startsWith("/") || relative.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Invalid public file path: ${relative}.`);
  }
  let candidate = base;
  for (const part of relative.split("/")) {
    candidate = path.join(candidate, part);
    if ((await lstat(candidate)).isSymbolicLink()) {
      throw new Error(`Symbolic links cannot be published: ${relative}.`);
    }
  }
  if (!(await lstat(candidate)).isFile() ||
      !((await realpath(candidate)).startsWith(`${await realpath(base)}${path.sep}`))) {
    throw new Error(`Public file is not contained in its guide: ${relative}.`);
  }
  return candidate;
}

if (!Array.isArray(catalog) || catalog.length === 0) {
  throw new Error("The public guide catalog must contain at least one guide.");
}
const existingOutput = await lstat(output).catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (existingOutput && (existingOutput.isSymbolicLink() || !existingOutput.isDirectory())) {
  throw new Error("_site must be a normal generated directory, not a file or symbolic link.");
}

for (const guide of catalog) {
  if (!guide || typeof guide !== "object" || typeof guide.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(guide.slug) || slugs.has(guide.slug)) {
    throw new Error("Guide slugs must be unique lowercase URL-safe identifiers.");
  }
  slugs.add(guide.slug);
  for (const field of ["title", "topic", "summary", "published"]) checkString(guide[field], field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(guide.published) ||
      !Number.isFinite(Date.parse(guide.published)) ||
      new Date(guide.published).toISOString().slice(0, 10) !== guide.published) {
    throw new Error(`Invalid publication date for ${guide.slug}.`);
  }
  if (!Number.isInteger(guide.minutes) || guide.minutes <= 0 ||
      !Number.isInteger(guide.chapters) || guide.chapters <= 0 ||
      !Array.isArray(guide.tags) || !guide.tags.length) {
    throw new Error(`Invalid duration, chapters, or tags for ${guide.slug}.`);
  }
  guide.tags.forEach(tag => checkString(tag, "tag"));
  if (!Array.isArray(guide.files) || !guide.files.includes("index.html") ||
      new Set(guide.files).size !== guide.files.length) {
    throw new Error(`An explicit, non-duplicated file list including index.html is required for ${guide.slug}.`);
  }
  checkPublicText(JSON.stringify(guide), `catalog entry ${guide.slug}`);
  const base = path.join(root, "guides", guide.slug);
  for (const relative of guide.files) {
    if (relative !== "index.html" && !/^assets\/[\w./ -]+$/.test(relative)) {
      throw new Error(`Only the customer index and explicit assets may be published: ${relative}.`);
    }
    const source = await checkedFile(base, relative);
    if (relative === "index.html") {
      checkPublicText(await readFile(source, "utf8"), `${guide.slug}/${relative}`);
    }
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyFile(path.join(root, "index.html"), path.join(output, "index.html"));
await copyFile(path.join(root, "CNAME"), path.join(output, "CNAME"));
const publicCatalog = catalog.map(({ files, ...guide }) => guide);
await writeFile(path.join(output, "catalog.js"), `window.CUSTOMER_GUIDES = ${JSON.stringify(publicCatalog, null, 2)};\n`, "utf8");
for (const guide of catalog) {
  const base = path.join(root, "guides", guide.slug);
  for (const relative of guide.files) {
    const destination = path.join(output, "guides", guide.slug, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(await checkedFile(base, relative), destination);
  }
}
console.log(`Built ${catalog.length} public guide(s) from explicit file lists.`);
