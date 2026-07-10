/*
  script.js 负责“动态行为”和“数据读取”：
  1. 绘制背景粒子 canvas。
  2. 让自定义鼠标光圈跟随鼠标移动。
  3. 根据滚动位置高亮顶部菜单。
  4. 读取自动生成的 content/content-index.js 清单，并渲染 notes/repos/gallery 里的内容。
  5. 给动态生成的卡片补上滚动淡入和 hover 光晕效果。

  如果你想改“页面有什么内容从哪里读取”，主要看 renderNotes/renderRepos/renderGallery。
  如果你想改“长什么样”，优先去 styles.css。
*/

// 拿到背景 canvas 和绘图上下文。粒子背景全部画在这个 canvas 上。
const canvas = document.querySelector("#starfield");
const ctx = canvas.getContext("2d");

// 自定义鼠标光圈，以及顶部导航链接。
const cursor = document.querySelector(".cursor-dot");
const navLinks = document.querySelectorAll("[data-nav]");
const CONTENT_VERSION = "20260710-02";

// canvas 当前尺寸和背景粒子数组。
let width = 0;
let height = 0;
let stars = [];

// mouse 是真实鼠标位置；cursorPos 是光圈当前位置，用来做“延迟跟随”的柔和效果。
let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let cursorPos = { x: mouse.x, y: mouse.y };

// WeakSet 用来记录哪些元素已经绑定过观察器/hover 事件，避免重复绑定。
let observedRevealItems = new WeakSet();
let observedHoverTargets = new WeakSet();
let notesData = [];
let reposData = [];
let galleryData = [];
let updatesData = [];
let pendingOpenRect = null;
let currentOpenSource = null;
let lastDetailHash = "";
let isClosingReader = false;
let contentIndexCache = null;
let textFileCache = new Map();
let lastScrollY = window.scrollY;
let activeNoteType = "all";
let starfieldFrameId = null;
let starfieldTimeoutId = null;
let lastPointerActivityAt = performance.now();

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isReaderOpen() {
  return document.querySelector("#reader")?.classList.contains("is-open");
}

/*
  根据系统主题返回粒子和光晕颜色。
  CSS 负责页面主题，JS 这里负责 canvas 粒子颜色，因为 canvas 不是 CSS 直接画出来的。
*/
function getThemeColors() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark
    ? {
        glowA: "rgba(120, 240, 255, 0.16)",
        glowB: "rgba(255, 111, 174, 0.055)",
        star: "255, 255, 255",
      }
    : {
        glowA: "rgba(0, 158, 195, 0.105)",
        glowB: "rgba(216, 73, 135, 0.055)",
        star: "30, 58, 86",
      };
}

/*
  把用户写在 Markdown/JSON 里的特殊字符转义。
  这样标题里即使有 < 或 "，也不会被浏览器误当成 HTML 执行。
*/
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function normalizeUrl(url) {
  return /^https?:\/\//i.test(url) ? url : "";
}

function resolveContentImageSrc(src, imageBasePath = "") {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("./") || src.startsWith("/")) {
    return src;
  }

  return `${imageBasePath}${src}`;
}

function renderInlineMarkdown(value, { allowLinks = true } = {}) {
  const placeholders = [];
  const hold = (html) => {
    const token = `@@MD_PLACEHOLDER_${placeholders.length}@@`;
    placeholders.push({ token, html });
    return token;
  };

  let text = value.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));

  if (allowLinks) {
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const href = normalizeUrl(url);
      if (!href) return escapeHtml(label);
      return hold(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    });

    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g, (match, prefix, url) => {
      return `${prefix}${hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`)}`;
    });
  }

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (const { token, html } of placeholders) {
    text = text.replace(escapeHtml(token), html);
  }

  return text;
}

function isCodeFence(line) {
  return /^`{2,3}[\w-]*\s*$/.test(line.trim());
}

function isStandaloneLink(line) {
  const text = line.trim();
  return /^\[[^\]]+\]\([^)\s]+\)$/.test(text) || /^https?:\/\/\S+$/.test(text);
}

/*
  把 Markdown 的前几行转换成首页卡片里的简短预览。
  这是一个轻量转换器，不是完整 Markdown 解析器：
  - # 标题会变成 <h3>
  - - 列表项会变成带圆点的段落
  - 普通行会变成 <p>
*/
function markdownToPreview(markdown, maxLines = 5) {
  const lines = [];
  let inCode = false;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (isCodeFence(line)) {
      inCode = !inCode;
      continue;
    }

    if (!line || inCode) continue;
    // 卡片预览里不显示 Markdown 标题，避免破坏“第一行 title，第二行 date/type”的结构。
    if (line.startsWith("#")) continue;
    // 单独一行的仓库链接在详情页更有价值，预览里跳过，避免 Markdown 原文挤乱卡片。
    if (isStandaloneLink(line)) continue;

    lines.push(line);
    if (lines.length >= maxLines) break;
  }

  return lines
    .map((line) => {
      if (line.startsWith("#")) {
        const text = line.replace(/^#+\s*/, "");
        return `<h3>${renderInlineMarkdown(text, { allowLinks: false })}</h3>`;
      }

      if (line.startsWith("- ")) {
        return `<p>${renderInlineMarkdown(line.replace(/^- /, "• "), { allowLinks: false })}</p>`;
      }

      return `<p>${renderInlineMarkdown(line, { allowLinks: false })}</p>`;
    })
    .join("");
}

/*
  把 Markdown 转成详情页可阅读的 HTML。
  这里仍然是轻量转换器，支持标题、段落、列表、代码块和常见行内格式，够个人 blog 起步使用。
*/
function markdownToHtml(markdown, { imageBasePath = "" } = {}) {
  const lines = markdown.split("\n");
  let html = "";
  let inList = false;
  let inCode = false;
  let codeLines = [];

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (isCodeFence(line)) {
      if (inCode) {
        html += `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      html += `<h1>${renderInlineMarkdown(line.replace(/^#\s+/, ""))}</h1>`;
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      html += `<h2>${renderInlineMarkdown(line.replace(/^##\s+/, ""))}</h2>`;
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      html += `<h3>${renderInlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`;
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${renderInlineMarkdown(line.replace(/^- /, ""))}</li>`;
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (imageMatch) {
      closeList();
      const [, alt, src] = imageMatch;
      const [altText, layoutHint = ""] = alt.split("|").map((part) => part.trim());
      const layoutClass = ["wide", "portrait", "square"].includes(layoutHint) ? ` is-${layoutHint}` : "";
      html += `<figure class="reader-photo${layoutClass}"><img src="${escapeHtml(resolveContentImageSrc(src, imageBasePath))}" alt="${escapeHtml(altText)}" /></figure>`;
      continue;
    }

    closeList();
    html += `<p>${renderInlineMarkdown(line.trim())}</p>`;
  }

  closeList();

  if (inCode) {
    html += `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
  }

  return html;
}

// 卡片本身已经显示 title，所以预览时去掉 Markdown 第一行 # 标题，避免重复。
function stripFirstHeading(markdown) {
  return markdown.replace(/^\s*#\s+.*(?:\n|$)/, "");
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/*
  根据浏览器窗口尺寸重设 canvas。
  devicePixelRatio 用来让高清屏上的粒子不模糊，但最多限制到 2，避免太耗性能。
*/
function resizeCanvas() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  // 重置渐变缓存，让 drawStarfield 在下个 rAF 重建渐变。
  cachedGlowGradient = null;
  lastGlowMouse = { x: -1000, y: -1000 };

  // 根据屏幕面积决定粒子数量：屏幕越大粒子越多，但有上下限。
  const count = Math.floor(Math.min(180, Math.max(90, width * height * 0.00013)));
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random() * 0.9 + 0.1,
    r: Math.random() * 1.8 + 0.45,
    vx: (Math.random() - 0.5) * 0.16,
    vy: (Math.random() - 0.5) * 0.16,
  }));
}

/*
  每一帧绘制背景粒子。
  requestAnimationFrame 会让浏览器在下一帧继续调用这个函数，形成连续动画。
*/

// 缓存上次鼠标位置和径向渐变，避免每帧重建 createRadialGradient。
let lastGlowMouse = { x: -1000, y: -1000 };
let cachedGlowGradient = null;

function drawStarfield() {
  starfieldFrameId = null;

  if (document.hidden || isReaderOpen()) {
    starfieldTimeoutId = null;
    return;
  }

  const theme = getThemeColors();
  ctx.clearRect(0, 0, width, height);

  // 鼠标附近的彩色柔光，鼠标移动时光晕中心也跟着移动。
  // 只在鼠标移动超过阈值时重建渐变，大幅减少 createRadialGradient 调用。
  const gradientRadius = Math.max(width, height) * 0.08;
  const dx = mouse.x - lastGlowMouse.x;
  const dy = mouse.y - lastGlowMouse.y;
  if (Math.abs(dx) > 6 || Math.abs(dy) > 6 || !cachedGlowGradient) {
    lastGlowMouse = { x: mouse.x, y: mouse.y };
    cachedGlowGradient = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, gradientRadius);
    cachedGlowGradient.addColorStop(0, theme.glowA);
    cachedGlowGradient.addColorStop(0.34, theme.glowB);
    cachedGlowGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  }
  ctx.fillStyle = cachedGlowGradient;
  ctx.fillRect(0, 0, width, height);

  // 逐个更新并绘制粒子。
  for (const star of stars) {
    // pullX/pullY 让粒子受到鼠标方向的轻微牵引，看起来更有空间感。
    const pullX = (mouse.x - width / 2) * star.z * 0.014;
    const pullY = (mouse.y - height / 2) * star.z * 0.014;
    star.x += star.vx + pullX * 0.006;
    star.y += star.vy + pullY * 0.006;

    // 粒子飞出屏幕后，从另一侧回到画面里，保证背景一直有点。
    if (star.x < -20) star.x = width + 20;
    if (star.x > width + 20) star.x = -20;
    if (star.y < -20) star.y = height + 20;
    if (star.y > height + 20) star.y = -20;

    ctx.beginPath();
    ctx.arc(star.x + pullX, star.y + pullY, star.r * star.z, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${theme.star}, ${0.16 + star.z * 0.44})`;
    ctx.fill();
  }

  scheduleStarfield();
}

function scheduleStarfield() {
  if (starfieldFrameId || starfieldTimeoutId || document.hidden || isReaderOpen()) return;

  const idleFor = performance.now() - lastPointerActivityAt;
  if (idleFor > 3000) {
    starfieldTimeoutId = window.setTimeout(() => {
      starfieldTimeoutId = null;
      starfieldFrameId = requestAnimationFrame(drawStarfield);
    }, 80);
    return;
  }

  starfieldFrameId = requestAnimationFrame(drawStarfield);
}

function pauseStarfield() {
  if (starfieldFrameId) {
    cancelAnimationFrame(starfieldFrameId);
    starfieldFrameId = null;
  }

  if (starfieldTimeoutId) {
    clearTimeout(starfieldTimeoutId);
    starfieldTimeoutId = null;
  }
}

function resumeStarfield() {
  lastPointerActivityAt = performance.now();
  scheduleStarfield();
}

/*
  自定义鼠标光圈动画。
  它不是立刻跳到鼠标位置，而是每一帧靠近一点，所以会有顺滑的拖尾感。
  注意：.cursor-dot 已在 CSS 中设为 display: none，此函数提前返回以节省 rAF 开销。
*/
function animateCursor() {
  return;
  cursorPos.x += (mouse.x - cursorPos.x) * 0.18;
  cursorPos.y += (mouse.y - cursorPos.y) * 0.18;
  cursor.style.transform = `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0) translate(-50%, -50%)`;
  requestAnimationFrame(animateCursor);
}

/*
  根据当前滚动位置高亮顶部导航。
  判断逻辑：哪个 section 的顶部已经进入视口上方 42% 以内，就认为当前在这个栏目。
*/
function updateActiveNav() {
  const current = [...navLinks].findLast((link) => {
    const section = document.querySelector(link.getAttribute("href"));
    return section && section.getBoundingClientRect().top < window.innerHeight * 0.42;
  });

  navLinks.forEach((link) => link.classList.toggle("is-active", link === current));
}

function updateHeaderVisibility() {
  const currentScrollY = window.scrollY;
  const delta = currentScrollY - lastScrollY;

  if (isReaderOpen() || currentScrollY < 80) {
    document.body.classList.remove("is-header-hidden");
  } else if (delta > 8) {
    document.body.classList.add("is-header-hidden");
  } else if (delta < -8) {
    document.body.classList.remove("is-header-hidden");
  }

  lastScrollY = currentScrollY;
}

function handlePageScroll() {
  updateActiveNav();
  updateHeaderVisibility();
}

/*
  IntersectionObserver 用来做滚动入场动画。
  当带 data-reveal 的元素进入视口，就给它加 is-visible 类。
  CSS 里的 [data-reveal].is-visible 决定动画最终状态。
*/
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.18 }
);

// 给某个范围内所有 data-reveal 元素注册滚动出现动画。
function prepareReveal(root = document) {
  for (const item of root.querySelectorAll("[data-reveal]")) {
    if (!observedRevealItems.has(item)) {
      observedRevealItems.add(item);
      revealObserver.observe(item);
    }
  }
}

/*
  给链接、按钮、卡片绑定 hover 事件。
  鼠标移入时给 cursor 加 is-hovering 类，CSS 会把鼠标光圈变大。
*/
function prepareHover(root = document) {
  for (const target of root.querySelectorAll("a, button, .note-card, .repo-card, .update-card, .gallery-item, .reader-back")) {
    if (!observedHoverTargets.has(target)) {
      observedHoverTargets.add(target);
      target.addEventListener("pointerenter", () => cursor.classList.add("is-hovering"));
      target.addEventListener("pointerleave", () => cursor.classList.remove("is-hovering"));
    }
  }
}

// 读取文本文件。这里主要用来读取 .md 内容。
async function readText(path) {
  if (textFileCache.has(path)) return textFileCache.get(path);

  const separator = path.includes("?") ? "&" : "?";
  const cacheKey = `${CONTENT_VERSION}-${Date.now()}`;
  const response = await fetch(`${path}${separator}v=${cacheKey}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load ${path}`);
  const text = await response.text();
  textFileCache.set(path, text);
  return text;
}

/*
  读取自动生成的内容清单。
  重要：浏览器里的静态网页不能直接扫描文件夹，所以 generate-content-index.py
  会在你启动 blog 前把文件夹里真实存在的内容写到 window.BLOG_CONTENT。
  你平时只要增删 Markdown/图片，然后重新运行 start-blog.command 即可。
*/
async function loadContentIndex() {
  if (contentIndexCache) return contentIndexCache;

  try {
    contentIndexCache = JSON.parse(await readText("./content/content-index.json"));
    window.BLOG_CONTENT = contentIndexCache;
    return contentIndexCache;
  } catch (error) {
    console.warn("content-index.json 读取失败，退回使用 content-index.js", error);
  }

  contentIndexCache = window.BLOG_CONTENT;
  return contentIndexCache;
}

function getContentIndex() {
  const index = contentIndexCache || window.BLOG_CONTENT;
  if (!index) {
    throw new Error("content/content-index.json is missing. Run start-blog.command again.");
  }

  return {
    notes: Array.isArray(index.notes) ? index.notes : [],
    repos: Array.isArray(index.repos) ? index.repos : [],
    gallery: Array.isArray(index.gallery) ? index.gallery : [],
    updates: Array.isArray(index.updates) ? index.updates : [],
  };
}

// URL hash 里不能直接放中文或特殊字符，所以统一 encode。
function detailHref(type, file) {
  return `#${type}/${encodeURIComponent(file)}`;
}

// 日期倒序：越新的内容越靠前；同一天保持自动清单里的原始顺序。
function sortByNewestDate(entries) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const byDate = b.entry.date.localeCompare(a.entry.date);
      return byDate || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/*
  渲染仓库：
  1. 从自动内容清单里拿到状态、标题、文件名。
  2. 逐个读取对应 Markdown。
  3. 生成 <article class="repo-card"> 卡片，插入 .repo-grid。
*/
async function renderRepos() {
  const container = document.querySelector(".repo-grid");
  const entries = getContentIndex().repos;
  reposData = entries;
  const cards = await Promise.all(
    entries.map(async (entry) => {
      const markdown = await readText(`./content/repos/${entry.file}`);
      return `
        <a class="content-link" href="${detailHref("repo", entry.file)}" data-reveal>
          <article class="repo-card">
            <span>${escapeHtml(entry.status)}</span>
            <h3>${escapeHtml(entry.title)}</h3>
            <div class="content-preview">${markdownToPreview(stripFirstHeading(markdown))}</div>
          </article>
        </a>
      `;
    })
  );
  container.innerHTML = cards.join("");

  // 因为这些卡片是 JS 后生成的，所以生成后要再补一次 reveal/hover 绑定。
  prepareReveal(container);
  prepareHover(container);
}

/*
  渲染笔记：
  布局是 note-card，标题下方显示 date 和 type。
*/
function renderNoteFilters(entries) {
  const container = document.querySelector(".note-filters");
  const types = [...new Set(entries.map((entry) => entry.type).filter(Boolean))];
  const options = [{ label: "全部", value: "all" }, ...types.map((type) => ({ label: type, value: type }))];

  container.innerHTML = options
    .map((option) => {
      const active = option.value === activeNoteType ? "is-active" : "";
      return `
        <button class="${active}" type="button" data-note-filter="${escapeHtml(option.value)}">
          ${escapeHtml(option.label)}
        </button>
      `;
    })
    .join("");

  prepareHover(container);
}

async function renderNoteCards(entries) {
  const container = document.querySelector(".note-grid");
  const cards = await Promise.all(
    entries.map(async (entry) => {
      const markdown = await readText(`./content/notes/${entry.file}`);
      return `
        <a class="content-link" href="${detailHref("note", entry.file)}" data-reveal>
          <article class="note-card">
            <h3>${escapeHtml(entry.title)}</h3>
            <p class="card-meta">${escapeHtml(entry.date)} / ${escapeHtml(entry.type)}</p>
            <div class="content-preview">${markdownToPreview(stripFirstHeading(markdown), 4)}</div>
          </article>
        </a>
      `;
    })
  );
  container.innerHTML =
    cards.join("") || `<div class="loading-row is-visible" data-reveal>这个类型下暂时没有笔记。</div>`;
  prepareReveal(container);
  prepareHover(container);
}

async function renderNotes() {
  const entries = sortByNewestDate(getContentIndex().notes);
  notesData = entries;
  renderNoteFilters(entries);
  const visibleEntries = activeNoteType === "all" ? entries : entries.filter((entry) => entry.type === activeNoteType);
  await renderNoteCards(visibleEntries);
}

/*
  渲染相册：
  读取 Markdown 相册记录，卡片展示封面、日期、地点和文字摘要。
*/
async function renderGallery() {
  const container = document.querySelector(".gallery-grid");
  const entries = getContentIndex().gallery;
  galleryData = entries;
  const cards = await Promise.all(
    entries.map(async (entry) => {
      const markdown = stripFrontmatter(await readText(`./content/gallery/${entry.file}`));
      const cover = entry.cover || "";
      return `
        <a class="content-link gallery-item" href="${detailHref("gallery", entry.file)}" data-reveal>
          <figure>
            ${cover ? `<img src="./content/gallery/${escapeHtml(cover)}" alt="${escapeHtml(entry.title)}" />` : ""}
            <figcaption>
              <span>${escapeHtml(entry.date)}${entry.place ? ` / ${escapeHtml(entry.place)}` : ""}</span>
              <strong>${escapeHtml(entry.title)}</strong>
              <small>${markdownToPreview(stripFirstHeading(markdown), 2)}</small>
            </figcaption>
          </figure>
        </a>
      `;
    })
  );
  container.innerHTML = cards.join("");
  prepareReveal(container);
  prepareHover(container);
}

/*
  渲染最近更新：
  读取 content/updates 里的 Markdown 历史，生成主页底部的更新卡片。
*/
async function renderUpdates() {
  const container = document.querySelector(".update-grid");
  const entries = getContentIndex().updates;
  updatesData = entries;
  const cards = await Promise.all(
    entries.map(async (entry) => {
      const markdown = await readText(`./content/updates/${entry.file}`);
      return `
        <a class="content-link is-visible" href="${detailHref("update", entry.file)}" data-reveal>
          <article class="update-card">
            <p class="card-meta">${escapeHtml(entry.type)}</p>
            <h3>${escapeHtml(entry.title)}</h3>
            <div class="content-preview">${markdownToPreview(stripFirstHeading(markdown), 5)}</div>
          </article>
        </a>
      `;
    })
  );
  container.innerHTML = cards.join("");
  prepareReveal(container);
  prepareHover(container);
}

function updateProfileStats() {
  document.querySelector('[data-stat="repos"]').textContent = String(reposData.length);
  document.querySelector('[data-stat="notes"]').textContent = String(notesData.length);
  document.querySelector('[data-stat="gallery"]').textContent = String(galleryData.length);
}

function setReader({ type, title, bodyHtml, backHref }) {
  const reader = document.querySelector("#reader");
  const shouldMorphOpen = pendingOpenRect && !prefersReducedMotion();

  reader.querySelector(".reader-type").textContent = type;
  reader.querySelector(".reader-title").textContent = title;
  reader.querySelector(".reader-body").innerHTML = bodyHtml;
  reader.querySelector(".reader-back").setAttribute("href", backHref);
  reader.classList.toggle("is-opening-from-card", Boolean(shouldMorphOpen));
  document.body.classList.add("is-reader-open");
  reader.classList.add("is-open");
  reader.setAttribute("aria-hidden", "false");
  pauseStarfield();
  prepareHover(reader);
  reader.scrollTop = 0;

  if (shouldMorphOpen) {
    animateReaderOpen(reader);
  } else {
    pendingOpenRect = null;
  }
}

function hideReader() {
  const reader = document.querySelector("#reader");
  reader.classList.remove("is-opening-from-card");
  reader.classList.remove("is-open");
  reader.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-reader-open");
  resumeStarfield();
}

async function openMarkdownDetail(kind, file) {
  const isNote = kind === "note";
  const isUpdate = kind === "update";
  const entries = isNote ? notesData : isUpdate ? updatesData : reposData;
  const entry = entries.find((item) => item.file === file);
  if (!entry) return;

  const folder = isNote ? "notes" : isUpdate ? "updates" : "repos";
  const markdown = await readText(`./content/${folder}/${file}`);
  setReader({
    type: isNote ? "Note" : isUpdate ? "Update" : "Repository",
    title: entry.title,
    // 详情页顶部已经有 reader-title，这里去掉 Markdown 第一行 H1，避免标题重复显示。
    bodyHtml: markdownToHtml(stripFirstHeading(markdown)),
    backHref: isNote ? "#notes" : isUpdate ? "#updates" : "#repos",
  });
}

async function openGalleryDetail(file) {
  const entry = galleryData.find((item) => item.file === file);
  if (!entry) return;

  const markdown = stripFrontmatter(await readText(`./content/gallery/${file}`));
  setReader({
    type: "Gallery",
    title: entry.title,
    bodyHtml: markdownToHtml(stripFirstHeading(markdown), { imageBasePath: "./content/gallery/" }),
    backHref: "#gallery",
  });
}

async function handleRoute() {
  const fullHash = window.location.hash;
  const hash = fullHash.slice(1);
  const [kind, encodedFile] = hash.split("/");

  if (isClosingReader) return;

  if (!encodedFile) {
    if (isReaderOpen() && lastDetailHash) {
      await animateReaderClose(fullHash || "#home", lastDetailHash, { updateHash: false });
      return;
    }

    hideReader();
    return;
  }

  const file = decodeURIComponent(encodedFile);

  if (kind === "note" || kind === "repo" || kind === "update") {
    await openMarkdownDetail(kind, file);
  } else if (kind === "gallery") {
    await openGalleryDetail(file);
  }

  lastDetailHash = fullHash;
}

/*
  点击卡片时记住卡片在页面里的位置和当时的滚动位置；
  返回列表时会用它恢复到原来的阅读位置。
*/
function recordOpenSource(link) {
  const rect = link.getBoundingClientRect();
  const href = link.getAttribute("href");
  pendingOpenRect = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
  currentOpenSource = {
    href,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function createMorphSurface(rect) {
  const surface = document.createElement("div");
  surface.className = "reader-morph-surface";
  Object.assign(surface.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.append(surface);
  return surface;
}

async function animateReaderOpen(reader) {
  const panel = reader.querySelector(".reader-panel");
  const source = pendingOpenRect;
  pendingOpenRect = null;

  if (!panel || !source || !source.width || !source.height) {
    reader.classList.remove("is-opening-from-card");
    return;
  }

  await new Promise((resolve) => requestAnimationFrame(resolve));

  const endRect = panel.getBoundingClientRect();
  if (!endRect.width || !endRect.height) {
    reader.classList.remove("is-opening-from-card");
    return;
  }

  const surface = createMorphSurface(endRect);
  surface.style.willChange = "transform, opacity";
  const sx = source.width / endRect.width;
  const sy = source.height / endRect.height;
  const tx = source.left - endRect.left;
  const ty = source.top - endRect.top;

  const animation = surface.animate(
    [
      { transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`, opacity: 0.72 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  );

  await animation.finished.catch(() => {});
  surface.style.willChange = "";
  surface.remove();
  reader.classList.remove("is-opening-from-card");
}

function findCurrentDetailLink(detailHash = window.location.hash) {
  const hash = detailHash;
  return [...document.querySelectorAll(".content-link")].find((link) => link.getAttribute("href") === hash);
}

function setHashWithoutJump(hash) {
  if (window.location.hash === hash) return;
  history.pushState(null, "", hash);
  updateActiveNav();
}

function hideReturnTarget(targetLink) {
  const previousVisibility = targetLink.style.visibility;
  targetLink.style.visibility = "hidden";
  return () => {
    targetLink.style.visibility = previousVisibility;
  };
}

function restoreListPositionForReturn(targetLink, detailHash) {
  const sourceMatchesCurrentDetail = currentOpenSource?.href === detailHash;

  if (sourceMatchesCurrentDetail) {
    window.scrollTo({
      left: currentOpenSource.scrollX,
      top: currentOpenSource.scrollY,
      behavior: "instant",
    });
    return;
  }

  // 只有直接打开详情 URL、没有点击来源记录时才用兜底定位。
  targetLink.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
}

/*
  详情关闭动画：用一个轻量玻璃表面从阅读面板位置缩回原卡片。
  这里会恢复到点开内容时的滚动位置，不再让主页滚动去寻找原卡片。
*/
async function animateReaderClose(backHref, detailHash = window.location.hash, { updateHash = true } = {}) {
  const reader = document.querySelector("#reader");
  const panel = document.querySelector(".reader-panel");
  const targetLink = findCurrentDetailLink(detailHash);

  if (!reader || !panel || !reader.classList.contains("is-open") || prefersReducedMotion()) {
    hideReader();
    if (updateHash) setHashWithoutJump(backHref);
    lastDetailHash = "";
    return;
  }

  isClosingReader = true;

  const startRect = panel.getBoundingClientRect();

  if (!targetLink || !startRect.width || !startRect.height) {
    const fallback = panel.animate(
      [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0, transform: "translateY(12px) scale(0.985)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.7, 0, 0.84, 0)" }
    );
    await fallback.finished.catch(() => {});
    hideReader();
    if (updateHash) setHashWithoutJump(backHref);
    lastDetailHash = "";
    isClosingReader = false;
    return;
  }

  const surface = createMorphSurface(startRect);

  hideReader();
  restoreListPositionForReturn(targetLink, detailHash);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const endRect = targetLink.getBoundingClientRect();
  if (!endRect.width || !endRect.height) {
    surface.remove();
    if (updateHash) setHashWithoutJump(backHref);
    lastDetailHash = "";
    isClosingReader = false;
    return;
  }

  const restoreTargetVisibility = hideReturnTarget(targetLink);

  // 用 transform 代替 left/top/width/height 动画，只走 GPU 合成层。
  surface.style.willChange = "transform, opacity";
  const sx = endRect.width / startRect.width;
  const sy = endRect.height / startRect.height;
  const tx = endRect.left - startRect.left;
  const ty = endRect.top - startRect.top;

  const animation = surface.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`, opacity: 0.72 },
    ],
    { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  );

  await animation.finished.catch(() => {});
  surface.style.willChange = "";
  surface.remove();
  restoreTargetVisibility();
  if (updateHash) setHashWithoutJump(backHref);
  currentOpenSource = null;
  lastDetailHash = "";
  isClosingReader = false;
}

/*
  单个板块的安全渲染器。
  以前这里用一个总的 try/catch：只要笔记/仓库/相册任何一个失败，
  所有还没被替换的 loading-row 都会显示“内容读取失败”。
  现在每个板块独立处理，哪个失败就只提示哪个板块。
*/
async function renderSection(label, renderFn, selector) {
  try {
    await renderFn();
  } catch (error) {
    console.error(`${label}读取失败`, error);
    const row = document.querySelector(`${selector} .loading-row`);
    if (row) {
      row.dataset.error = error.message || String(error);
      row.textContent = `${label}读取失败：请重新运行 start-blog.command，让系统自动刷新内容清单。`;
    }
  }
}

/*
  总入口：并行读取笔记、仓库、相册。
  三个板块相互独立，某个板块失败不会影响另外两个板块显示。
*/
async function renderContent() {
  await loadContentIndex();
  await Promise.all([
    renderSection("笔记", renderNotes, ".note-grid"),
    renderSection("仓库", renderRepos, ".repo-grid"),
    renderSection("相册", renderGallery, ".gallery-grid"),
    renderSection("最近更新", renderUpdates, ".update-grid"),
  ]);
  updateProfileStats();
  await handleRoute();
}

/*
  监听鼠标移动：
  1. 更新背景粒子和自定义光标要追踪的 mouse 坐标。
  2. 如果鼠标在仓库/笔记卡片上，就把鼠标在卡片里的坐标写入 --x / --y。
     CSS 用这两个变量来决定 hover 光晕的位置。
  注意：卡片光晕写入用 rAF 节流，避免 pointermove 高频触发重排。
*/

let glowTicking = false;
let latestGlowEvent = null;

document.addEventListener("pointermove", (event) => {
  lastPointerActivityAt = performance.now();
  scheduleStarfield();
  mouse = { x: event.clientX, y: event.clientY };
  latestGlowEvent = event;

  if (glowTicking) return;
  glowTicking = true;
  requestAnimationFrame(() => {
    const e = latestGlowEvent;
    latestGlowEvent = null;
    if (e) {
      const glowTarget = e.target.closest(".repo-card, .note-card, .update-card");
      if (glowTarget) {
        const rect = glowTarget.getBoundingClientRect();
        glowTarget.style.setProperty("--x", `${e.clientX - rect.left}px`);
        glowTarget.style.setProperty("--y", `${e.clientY - rect.top}px`);
      }
    }
    glowTicking = false;
  });
});

document.addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-note-filter]");
  if (filterButton) {
    activeNoteType = filterButton.getAttribute("data-note-filter") || "all";
    renderNotes();
    return;
  }

  const back = event.target.closest(".reader-back");
  if (back) {
    const href = back.getAttribute("href") || "#notes";
    event.preventDefault();

    if (currentOpenSource && window.location.hash === currentOpenSource.href) {
      history.back();
      return;
    }

    animateReaderClose(href);
    return;
  }

  const link = event.target.closest(".content-link");
  if (!link) return;

  const href = link.getAttribute("href");
  if (!href || !href.startsWith("#")) return;

  event.preventDefault();
  recordOpenSource(link);

  if (window.location.hash === href) {
    handleRoute();
  } else {
    setHashWithoutJump(href);
    handleRoute();
  }
});

// 窗口尺寸变化时重设 canvas；页面滚动时更新导航高亮。
window.addEventListener("resize", resizeCanvas);
window.addEventListener("scroll", handlePageScroll, { passive: true });
window.addEventListener("hashchange", handleRoute);
window.addEventListener("popstate", handleRoute);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseStarfield();
  } else {
    resumeStarfield();
  }
});

/*
  初始化顺序：
  1. 先给 HTML 里已有元素绑定 reveal/hover。
  2. 设置 canvas 尺寸。
  3. 启动背景粒子和鼠标光圈动画。
  4. 更新一次导航状态。
  5. 读取内容文件并渲染笔记、仓库、相册。
*/
prepareReveal();
prepareHover();
resizeCanvas();
scheduleStarfield();
animateCursor();
updateActiveNav();
renderContent();
