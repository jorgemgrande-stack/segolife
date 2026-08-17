// Genera los PDFs de entrega a cliente a partir de docs/handbook/*.md.
// Fuente exclusiva: los Markdown ya existentes (no se reescribe contenido).
// Uso: node scripts/generate-handbook-pdfs.mjs
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "docs/handbook");
const OUT = path.join(SRC, "pdf");
const CACHE = path.join(OUT, "_cache");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const MANUALS = [
  { key: "doc00", src: "00-manual-general.md", out: "01_SEGOLIFE_Manual_General.pdf", n: 1 },
  { key: "doc01", src: "01-responsable-local.md", out: "02_SEGOLIFE_Manual_Responsable_Local.pdf", n: 2 },
  { key: "doc02", src: "02-administrador.md", out: "03_SEGOLIFE_Manual_Administrador.pdf", n: 3 },
  { key: "doc03", src: "03-empleado.md", out: "04_SEGOLIFE_Manual_Empleado.pdf", n: 4 },
  { key: "doc04", src: "04-accesos-venues.md", out: "05_SEGOLIFE_Accesos_Responsables_Local.pdf", n: 5 },
  { key: "doc05", src: "05-guia-rapida-venue.md", out: "06_SEGOLIFE_Guia_Rapida_Responsable_Local.pdf", n: 6 },
];
const FILE_TO_PDF = Object.fromEntries(MANUALS.map((m) => [m.src, m.out]));
const FILE_TO_KEY = Object.fromEntries(MANUALS.map((m) => [m.src, m.key]));
const FILE_TO_LABEL = {
  "00-manual-general.md": "Manual General",
  "01-responsable-local.md": "Manual del Responsable de Local",
  "02-administrador.md": "Manual de Administración",
  "03-empleado.md": "Manual del Empleado",
  "04-accesos-venues.md": "Accesos de Responsables de Local",
  "05-guia-rapida-venue.md": "Guía Rápida del Responsable de Local",
};

const VERSION = "v1.0";
const DATE_LABEL = "Agosto 2026";
const ENTITY = "HAYQUE CAPITAL, S.L. · CIF B13989264 · Finca Lindaraja, s/n, 40420 Segovia";

// ---------------------------------------------------------------------------
// Fuentes reales de marca (Inter + Playfair Display, ya usadas en la app),
// incrustadas como base64 para que el render sea autocontenido.
// ---------------------------------------------------------------------------
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });
  return await res.text();
}

async function embedGoogleFont(family, weights) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights.join(";")}&display=swap`;
  const css = await fetchText(url);
  const blocks = css.split("@font-face").slice(1).map((b) => "@font-face" + b);
  let out = "";
  for (const block of blocks) {
    const m = block.match(/url\(([^)]+)\)\s*format\('woff2'\)/);
    if (!m) continue;
    const fontUrl = m[1];
    const cacheFile = path.join(CACHE, crypto.createHash("md5").update(fontUrl).digest("hex") + ".woff2");
    let bytes;
    if (fs.existsSync(cacheFile)) {
      bytes = fs.readFileSync(cacheFile);
    } else {
      const r = await fetch(fontUrl);
      bytes = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(cacheFile, bytes);
    }
    const b64 = bytes.toString("base64");
    out += block.replace(/url\([^)]+\)\s*format\('woff2'\)/, `url(data:font/woff2;base64,${b64}) format('woff2')`) + "\n";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");
function slugify(s, prefix) {
  const base = s
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return prefix ? `${prefix}-${base}` : base;
}

function imageDataUri(relSrc) {
  const abs = path.join(SRC, relSrc);
  const bytes = fs.readFileSync(abs);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function escapeHtml(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text, { linkMode = "single" } = {}) {
  let t = escapeHtml(text);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
    let url = href;
    let text = label;
    if (FILE_TO_PDF[href]) {
      url = linkMode === "master" ? `#${FILE_TO_KEY[href]}-top` : FILE_TO_PDF[href];
      if (FILE_TO_LABEL[href]) text = FILE_TO_LABEL[href];
    }
    return `<a href="${url}">${text}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}

// ---------------------------------------------------------------------------
// Parser Markdown → bloques HTML (subconjunto usado en docs/handbook/*.md)
// ---------------------------------------------------------------------------
function parseMarkdown(md, { idPrefix = "", linkMode = "single" } = {}) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const h1 = lines[0].replace(/^#\s+/, "").trim();
  const titleShort = h1.includes("—") ? h1.split("—")[1].trim() : h1;

  let i = 1;
  const toc = [];
  const introParts = [];
  const bodyParts = [];
  let sawH2 = false;
  const opts = { linkMode };

  while (i < lines.length && lines[i].trim() === "") i++;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      const level = m[1].length;
      const text = m[2].trim();
      const id = slugify(text, idPrefix);
      if (level === 2) sawH2 = true;
      toc.push({ level, id, text });
      bodyParts.push(`<h${level} id="${id}">${renderInline(text, opts)}</h${level}>`);
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      bodyParts.push('<hr/>');
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const qLines = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        qLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const paras = qLines
        .join("\n")
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!sawH2) {
        for (const p of paras) introParts.push(`<p>${renderInline(p.replace(/\n/g, " "), opts)}</p>`);
      } else {
        const isWarning = /⚠️/.test(qLines.join(" "));
        const cls = isWarning ? "callout callout-warning" : "callout callout-note";
        const inner = paras.map((p) => `<p>${renderInline(p.replace(/\n/g, " "), opts)}</p>`).join("");
        bodyParts.push(`<div class="${cls}">${inner}</div>`);
      }
      continue;
    }

    if (line.trim().startsWith("|")) {
      const tLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tLines.push(lines[i]);
        i++;
      }
      const rows = tLines.map((l) =>
        l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
      );
      const header = rows[0];
      const body = rows.slice(2);
      let html = '<div class="table-wrap"><table><thead><tr>' +
        header.map((h) => `<th>${renderInline(h, opts)}</th>`).join("") +
        "</tr></thead><tbody>";
      for (const r of body) {
        html += "<tr>" + r.map((c) => `<td>${renderInline(c, opts)}</td>`).join("") + "</tr>";
      }
      html += "</tbody></table></div>";
      bodyParts.push(html);
      continue;
    }

    if (/^!\[([^\]]*)\]\(([^)]+)\)\s*$/.test(line.trim())) {
      const im = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      const [, alt, src] = im;
      bodyParts.push(
        `<figure><img src="${imageDataUri(src)}" alt="${escapeHtml(alt)}"/><figcaption>${renderInline(alt, opts)}</figcaption></figure>`
      );
      i++;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") break;
        const om = l.match(/^\d+\.\s+(.*)$/);
        const subm = l.match(/^\s{2,}-\s+(.*)$/);
        if (om) {
          items.push({ text: om[1], sub: [] });
          i++;
        } else if (subm && items.length) {
          items[items.length - 1].sub.push(subm[1]);
          i++;
        } else if (/^\s+\S/.test(l) && items.length) {
          const last = items[items.length - 1];
          if (last.sub.length) {
            last.sub[last.sub.length - 1] += " " + l.trim();
          } else {
            last.text += " " + l.trim();
          }
          i++;
        } else break;
      }
      const html = "<ol>" + items.map((it) => {
        let li = `<li>${renderInline(it.text, opts)}`;
        if (it.sub.length) li += "<ul class=\"nested\">" + it.sub.map((s) => `<li>${renderInline(s, opts)}</li>`).join("") + "</ul>";
        return li + "</li>";
      }).join("") + "</ol>";
      bodyParts.push(html);
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") break;
        const um = l.match(/^-\s+(.*)$/);
        if (um) {
          items.push(um[1]);
          i++;
        } else if (/^\s+\S/.test(l) && items.length) {
          items[items.length - 1] += " " + l.trim();
          i++;
        } else break;
      }
      bodyParts.push("<ul>" + items.map((it) => `<li>${renderInline(it, opts)}</li>`).join("") + "</ul>");
      continue;
    }

    // párrafo
    {
      const pLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^#{2,3}\s/.test(lines[i]) &&
        !/^-{3,}$/.test(lines[i].trim()) &&
        !lines[i].startsWith(">") &&
        !lines[i].trim().startsWith("|") &&
        !/^!\[/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i]) &&
        !/^-\s+/.test(lines[i])
      ) {
        pLines.push(lines[i]);
        i++;
      }
      if (pLines.length) {
        bodyParts.push(`<p>${renderInline(pLines.join(" "), opts)}</p>`);
      } else {
        i++;
      }
    }
  }

  return { titleFull: h1, titleShort, introHtml: introParts.join(""), toc, bodyHtml: bodyParts.join("\n") };
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
function buildCss(fontsCss) {
  return `
${fontsCss}
:root {
  --ink:#181225; --body:#372f47; --muted:#726c82; --line:#e6e2ef;
  --paper:#ffffff; --paper-tint:#faf8fd;
  --violet:#7c3aed; --violet-deep:#5b21b6; --violet-100:#f2eafe; --violet-200:#e3d6fb;
  --brand1:#8b3fd1; --brand2:#6a2fb8;
  --orange:#f97316; --orange-100:#fff1e6; --orange-deep:#9a3412;
}
* { box-sizing:border-box; }
html,body { margin:0; padding:0; }
body { font-family:'Inter',Arial,sans-serif; color:var(--body); background:var(--paper); font-size:10.3pt; line-height:1.62; }
.display { font-family:'Playfair Display',Georgia,serif; }
h1,h2,h3 { font-family:'Inter',sans-serif; color:var(--ink); font-weight:700; }

/* ---- Portada ---- */
.cover {
  width:100%; min-height:271mm; color:#fff; position:relative;
  padding:20mm 20mm; display:flex; flex-direction:column; justify-content:space-between;
  page-break-after:always; break-after:page;
  background:
    radial-gradient(circle at 12% 96%, rgba(249,115,22,0.28), transparent 42%),
    radial-gradient(circle at 85% 8%, rgba(139,63,209,0.35), transparent 45%),
    linear-gradient(150deg, #0c0a15 0%, #2c1550 45%, var(--brand2) 78%, var(--brand1) 100%);
}
.cover .brand { display:flex; align-items:center; gap:10px; }
.cover .brand img { width:32px; height:32px; border-radius:9px; display:block; }
.cover .brand span { font-weight:800; font-size:14pt; letter-spacing:0.4px; }
.cover .middle { margin-top:34mm; }
.cover .eyebrow { text-transform:uppercase; letter-spacing:2.5px; font-size:8.5pt; color:#e7d6ff; font-weight:700; }
.cover .doc-title { font-size:33pt; line-height:1.16; max-width:140mm; margin:10px 0 14px; font-weight:700; }
.cover .doc-sub { font-size:11.5pt; color:#e6d9fb; max-width:118mm; line-height:1.55; }
.cover .meta { font-size:8.5pt; color:#d9c8f4; line-height:1.7; border-top:1px solid rgba(255,255,255,0.25); padding-top:12px; }
.cover .meta b { color:#fff; }
.cover .tagline { font-size:8.5pt; color:#c9b6ef; }

/* ---- Índice ---- */
.toc-page { min-height:271mm; padding:22mm 24mm 10mm; page-break-after:always; break-after:page; }
.toc-page .kicker { color:var(--violet); font-weight:700; letter-spacing:2px; text-transform:uppercase; font-size:8.5pt; }
.toc-page h1 { font-size:25pt; margin:6px 0 4px; }
.toc-page .intro { background:var(--paper-tint); border:1px solid var(--violet-200); border-radius:10px; padding:12px 16px; margin:16px 0 22px; }
.toc-page .intro p { color:var(--muted); font-size:9.3pt; margin:4px 0; }
.toc-list { list-style:none; padding:0; margin-top:10px; counter-reset:toc; }
.toc-list li { display:flex; align-items:baseline; gap:8px; padding:8px 0; border-bottom:1px dotted var(--line); }
.toc-list li.lvl3 { padding-left:20px; border-bottom:none; padding-top:0; padding-bottom:6px; }
.toc-list a { color:var(--ink); text-decoration:none; font-weight:600; font-size:10.5pt; }
.toc-list li.lvl3 a { color:var(--muted); font-weight:500; font-size:9.5pt; }
.toc-list .dots { flex:1; border-bottom:1px dotted var(--line); margin-bottom:4px; }

/* ---- Contenido ---- */
.content { padding:0 22mm 8mm; }
.content h2 { font-size:15.5pt; color:var(--violet-deep); border-bottom:2px solid var(--violet-200); padding-bottom:5px; margin-top:24pt; break-after:avoid-page; page-break-after:avoid; }
.content h3 { font-size:12pt; color:var(--ink); margin-top:16pt; break-after:avoid-page; page-break-after:avoid; }
.content p { margin:7pt 0; }
.content ul, .content ol { padding-left:20px; margin:7pt 0; }
.content li { margin:3.5pt 0; }
.content ul.nested { margin-top:4pt; }
.content a { color:var(--violet); text-decoration:underline; }
.content code { background:var(--violet-100); color:var(--violet-deep); padding:1px 5px; border-radius:4px; font-family:Consolas,'SFMono-Regular',monospace; font-size:0.9em; }
.content hr { border:none; border-top:1px solid var(--line); margin:20pt 0; }
.content strong { color:var(--ink); }

figure { margin:14pt 0; text-align:center; break-inside:avoid-page; page-break-inside:avoid; }
figure img { max-width:100%; width:100%; border:1px solid var(--line); border-radius:9px; box-shadow:0 6px 20px rgba(90,40,150,0.14); }
figcaption { font-size:8.3pt; color:var(--muted); margin-top:6pt; font-style:italic; }

.table-wrap { margin:12pt 0; break-inside:avoid-page; page-break-inside:avoid; }
table { width:100%; border-collapse:collapse; font-size:9.2pt; }
th { background:var(--violet); color:#fff; text-align:left; padding:7px 9px; font-weight:600; }
td { padding:6.5px 9px; border-bottom:1px solid var(--line); vertical-align:top; }
tbody tr:nth-child(even) td { background:var(--paper-tint); }

.callout { border-radius:10px; padding:12px 16px; margin:14pt 0; break-inside:avoid-page; page-break-inside:avoid; }
.callout p { margin:3pt 0; }
.callout-note { background:var(--paper-tint); border-left:4px solid var(--violet); }
.callout-warning { background:var(--orange-100); border-left:5px solid var(--orange); }
.callout-warning p:first-child { font-weight:700; color:var(--orange-deep); }

.section-divider { page-break-before:always; break-before:page; padding-top:14mm; }
.section-divider .eyebrow { color:var(--orange); font-weight:800; letter-spacing:2px; text-transform:uppercase; font-size:9pt; }
.section-divider h1 { font-size:24pt; margin:6px 0 4px; color:var(--violet-deep); }
.section-divider .rule { height:3px; width:52px; background:var(--orange); margin:10px 0 4px; border-radius:2px; }
`;
}

// ---------------------------------------------------------------------------
// Plantillas HTML
// ---------------------------------------------------------------------------
function logoImg() {
  const svgPath = path.join(ROOT, "client/public/icons/segolife-icon.svg");
  const svg = fs.readFileSync(svgPath, "utf8");
  const b64 = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}
const LOGO = logoImg();

function coverHtml({ titleShort, subtitle, n }) {
  return `
<section class="cover">
  <div class="brand"><img src="${LOGO}" alt="Segolife"/><span>SEGOLIFE</span></div>
  <div class="middle">
    <div class="eyebrow">Documentación de plataforma ${n ? `· ${n} de 6` : ""}</div>
    <div class="doc-title display">${titleShort}</div>
    <div class="doc-sub">${subtitle}</div>
  </div>
  <div class="meta">
    <div>Versión ${VERSION} · ${DATE_LABEL}</div>
    <div><b>${ENTITY}</b></div>
    <div class="tagline">Segovia · Vida universitaria</div>
  </div>
</section>`;
}

function tocHtml({ titleShort, introHtml, toc }) {
  const items = toc.map((t) => {
    if (t.level === 2) return `<li><a href="#${t.id}">${t.text}</a></li>`;
    return `<li class="lvl3"><a href="#${t.id}">${t.text}</a></li>`;
  }).join("");
  return `
<section class="toc-page">
  <div class="kicker">Índice</div>
  <h1 class="display">${titleShort}</h1>
  ${introHtml ? `<div class="intro">${introHtml}</div>` : ""}
  <ul class="toc-list">${items}</ul>
</section>`;
}

const FOOTER_TEMPLATE = `
<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#5b21b6;display:flex;justify-content:center;">
  <span style="background:#ffffff;border:1px solid #e3d6fb;padding:3px 11px;border-radius:12px;">
    Página <span class="pageNumber"></span> de <span class="totalPages"></span>
  </span>
</div>`;
const HEADER_TEMPLATE = `<div></div>`;
const PDF_OPTS = {
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: HEADER_TEMPLATE,
  footerTemplate: FOOTER_TEMPLATE,
  margin: { top: "8mm", bottom: "18mm", left: "0mm", right: "0mm" },
  width: "210mm",
  height: "297mm",
};

const SUBTITLES = {
  doc00: "Qué es Segolife, roles, ecosistema y conceptos clave de la plataforma.",
  doc01: "Guía completa de operación diaria para el encargado de un local adherido.",
  doc02: "Command Center, gestión de comunidades, eventos, SegoTokens y RRHH.",
  doc03: "Autoservicio de RRHH: fichaje, nóminas, documentos y vacaciones.",
  doc04: "Listado oficial de accesos de los locales adheridos a la plataforma.",
  doc05: "Una página para empezar a operar en minutos.",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("Descargando/insertando fuentes de marca (Inter, Playfair Display)...");
  const fontsCss =
    (await embedGoogleFont("Inter", [400, 500, 600, 700, 800])) +
    (await embedGoogleFont("Playfair+Display", [600, 700]));
  const css = buildCss(fontsCss);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const parsed = {};
  for (const m of MANUALS) {
    const md = fs.readFileSync(path.join(SRC, m.src), "utf8");
    parsed[m.key] = { ...m, ...parseMarkdown(md, { idPrefix: "", linkMode: "single" }) };
  }

  const results = [];

  for (const m of MANUALS) {
    const d = parsed[m.key];
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><style>${css}</style></head><body>
      ${coverHtml({ titleShort: d.titleShort, subtitle: SUBTITLES[m.key], n: m.n })}
      ${tocHtml(d)}
      <section class="content">${d.bodyHtml}</section>
    </body></html>`;
    await page.setContent(html, { waitUntil: "networkidle" });
    const outPath = path.join(OUT, m.out);
    await page.pdf({ path: outPath, ...PDF_OPTS });
    const size = fs.statSync(outPath).size;
    results.push({ file: m.out, size, source: m.src });
    console.log(`OK  ${m.out}  (${(size / 1024).toFixed(0)} KB)`);
  }

  // -------- Master --------
  const masterTocGroups = MANUALS.map((m) => {
    const d = parsed[m.key];
    const items = d.toc.filter((t) => t.level === 2).map((t) => {
      const id = slugify(t.text, m.key);
      return `<li class="lvl3"><a href="#${id}">${t.text}</a></li>`;
    }).join("");
    return `<li><a href="#${m.key}-top"><strong>${m.n}. ${d.titleShort}</strong></a></li>${items}`;
  }).join("");

  const masterSections = MANUALS.map((m) => {
    const md = fs.readFileSync(path.join(SRC, m.src), "utf8");
    const d = parseMarkdown(md, { idPrefix: m.key, linkMode: "master" });
    return `
    <section class="section-divider" id="${m.key}-top">
      <div class="eyebrow">Manual ${m.n} de 6</div>
      <div class="rule"></div>
      <h1 class="display">${d.titleShort}</h1>
    </section>
    <section class="content">${d.bodyHtml}</section>`;
  }).join("\n");

  const masterHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><style>${css}</style></head><body>
    ${coverHtml({ titleShort: "Manual Completo", subtitle: "Los 6 manuales de uso y operación de Segolife, en un único documento.", n: null })}
    <section class="toc-page">
      <div class="kicker">Índice general</div>
      <h1 class="display">Manual Completo</h1>
      <div class="intro"><p>Este documento agrupa, en un único PDF, los 6 manuales de uso y operación de Segolife: general, Responsable de local, Administración, Empleado, Accesos de locales y guía rápida.</p></div>
      <ul class="toc-list">${masterTocGroups}</ul>
    </section>
    ${masterSections}
  </body></html>`;
  await page.setContent(masterHtml, { waitUntil: "networkidle" });
  const masterPath = path.join(OUT, "SEGOLIFE_MANUAL_COMPLETO.pdf");
  await page.pdf({ path: masterPath, ...PDF_OPTS });
  const masterSize = fs.statSync(masterPath).size;
  results.push({ file: "SEGOLIFE_MANUAL_COMPLETO.pdf", size: masterSize, source: "todos" });
  console.log(`OK  SEGOLIFE_MANUAL_COMPLETO.pdf  (${(masterSize / 1024).toFixed(0)} KB)`);

  await browser.close();

  fs.writeFileSync(path.join(OUT, "_manifest.json"), JSON.stringify(results, null, 2));
  console.log("\nListo. Manifest en docs/handbook/pdf/_manifest.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
