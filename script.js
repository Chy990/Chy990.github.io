/*
  script.js 负责“动态行为”和“数据读取”：
  1. 根据滚动位置高亮顶部菜单、隐藏/显示导航。
  2. 读取自动生成的 content/content-index.js 清单，并渲染 notes/repos/gallery 里的内容。
  3. 打开 Markdown 详情层、图片灯箱，并记住返回时的滚动位置。
  4. 浅色 / 深色主题切换。
  5. 滚动入场动画与阅读进度。

  如果你想改“页面有什么内容从哪里读取”，主要看 renderNotes/renderRepos/renderGallery。
  如果你想改“长什么样”，优先去 styles.css。
*/

// 只有脚本正常执行时，CSS 才会启用 [data-reveal] 的隐藏状态。
// 这样 JS 失效或加载失败时，页面内容不会被隐藏。
document.documentElement.classList.add("js");

const navLinks = document.querySelectorAll("[data-nav]");
const navElement = document.querySelector(".primary-nav");
const navLensElement = navElement?.querySelector(".nav-lens");
const pageShell = document.querySelector(".page-shell");
const CONTENT_VERSION = "20261019-54";
const BASE_TITLE = "Chen 的实验台";

// WeakSet 用来记录哪些元素已经绑定过观察器，避免重复绑定。
const observedRevealItems = new WeakSet();
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
let navHoverLink = null;
let navLensTarget = null;
let navTracking = false;
let navPinnedLink = null;
let navPinTimer = null;
let imageLightboxSession = null;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isReaderOpen() {
  return document.querySelector("#reader")?.classList.contains("is-open");
}

/*
  主题切换：按钮只改 <html data-theme>，颜色全部由 styles.css 的变量接管。
  每次打开/刷新都跟随设备主题；手动切换只在当前页面内覆盖。
*/
function setupThemeToggle() {
  const button = document.querySelector(".theme-toggle");
  if (!button) return;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  let manualOverride = false;

  const syncButton = () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const label = isDark ? "切换到浅色模式" : "切换到深色模式";
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    if (themeColor) themeColor.setAttribute("content", isDark ? "#14120f" : "#f4f1e8");
  };

  const applySystemTheme = () => {
    if (manualOverride) return;
    document.documentElement.setAttribute(
      "data-theme",
      colorScheme.matches ? "dark" : "light"
    );
    syncButton();
  };

  syncButton();

  if (typeof colorScheme.addEventListener === "function") {
    colorScheme.addEventListener("change", applySystemTheme);
  } else if (typeof colorScheme.addListener === "function") {
    colorScheme.addListener(applySystemTheme);
  }

  button.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    // 如果手动切回了系统当前主题，就让后续系统变化继续自动生效。
    manualOverride = next !== (colorScheme.matches ? "dark" : "light");
    syncButton();
  });
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

function galleryThumbnailSrc(src) {
  if (!src.startsWith("./content/gallery/")) return src;
  if (src.startsWith("./content/gallery/_thumbs/")) return src;

  return src
    .replace("./content/gallery/", "./content/gallery/_thumbs/")
    .replace(/\.(jpe?g|png)$/i, ".jpg");
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
  - - 列表项会变成带圆点的段落
  - 普通行会变成 <p>
  - dateHeadings 为 true 时，更新日志里的 ### 2026-09-16 会保留成日期标签
*/
function markdownToPreview(markdown, maxLines = 5, { dateHeadings = false } = {}) {
  const lines = [];
  let inCode = false;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (isCodeFence(line)) {
      inCode = !inCode;
      continue;
    }

    if (!line || inCode) continue;

    // 卡片预览里默认不显示 Markdown 标题，避免破坏“标题 + 日期 + 摘要”的结构。
    if (line.startsWith("#")) {
      if (dateHeadings && /^#{2,4}\s*\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(line)) {
        lines.push({ kind: "date", text: line.replace(/^#+\s*/, "") });
        if (lines.length >= maxLines) break;
      }
      continue;
    }

    // 单独一行的仓库链接在详情页更有价值，预览里跳过，避免 Markdown 原文挤乱卡片。
    if (isStandaloneLink(line)) continue;

    lines.push({ kind: "text", text: line });
    if (lines.length >= maxLines) break;
  }

  return lines
    .map(({ kind, text }) => {
      if (kind === "date") {
        return `<p class="update-date">${escapeHtml(text)}</p>`;
      }

      if (text.startsWith("- ")) {
        return `<p>${renderInlineMarkdown(text.replace(/^- /, "• "), { allowLinks: false })}</p>`;
      }

      return `<p>${renderInlineMarkdown(text, { allowLinks: false })}</p>`;
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
      const imageSrc = resolveContentImageSrc(src, imageBasePath);
      const safeImageSrc = escapeHtml(imageSrc);
      const previewSrc = galleryThumbnailSrc(imageSrc);
      const caption = altText ? `<figcaption>${escapeHtml(altText)}</figcaption>` : "";
      html += `<figure class="reader-photo${layoutClass} is-zoomable"><button class="reader-photo-button" type="button" data-lightbox-src="${safeImageSrc}" data-lightbox-alt="${escapeHtml(altText)}" aria-label="查看原图：${escapeHtml(altText || "图片")}"><img src="${escapeHtml(previewSrc)}" data-fallback-src="${safeImageSrc}" alt="${escapeHtml(altText)}" loading="lazy" decoding="async" /></button>${caption}</figure>`;
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
  粗略估算阅读时间：
  中文按每分钟 400 字、英文按每分钟 220 词计算。
  只用于卡片上的辅助信息，不需要非常精确。
*/
function readingMinutes(markdown) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`\[\]()!-]/g, " ");
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

/*
  顶部菜单的液态药丸。
  它只在 .primary-nav 内工作：默认停在当前栏目上，鼠标进入哪个菜单项就滑到哪。
*/
function setNavLensPosition(link) {
  if (!navLensElement || !link) return;
  navLensElement.style.setProperty("--lens-x", `${link.offsetLeft}px`);
  navLensElement.style.setProperty("--lens-w", `${link.offsetWidth}px`);
}

/*
  触屏拖动时药丸不被“吸附”到某个菜单项，而是以手指为中心连续移动。
  宽度仍然取最近菜单项的宽度，文字缩放也落到最近项上。
*/
function setNavLensTracking(clientX) {
  if (!navElement || !navLensElement) return;

  const links = [...navElement.querySelectorAll("a")];
  if (!links.length) return;

  let nearest = links[0];
  let nearestDistance = Infinity;

  for (const link of links) {
    const rect = link.getBoundingClientRect();
    const distance = Math.abs(clientX - (rect.left + rect.width / 2));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = link;
    }
  }

  if (nearest !== navHoverLink) {
    navHoverLink = nearest;
    navLinks.forEach((link) => link.classList.toggle("is-lens-target", link === nearest));
  }

  const width = nearest.offsetWidth;
  const navRect = navElement.getBoundingClientRect();
  const localX = clientX - navRect.left - navElement.clientLeft;
  const firstLink = links[0];
  const lastLink = links[links.length - 1];
  const minX = firstLink.offsetLeft;
  const maxX = lastLink.offsetLeft + lastLink.offsetWidth - width;
  const left = Math.min(maxX, Math.max(minX, localX - width / 2));

  navLensElement.style.setProperty("--lens-x", `${left}px`);
  navLensElement.style.setProperty("--lens-w", `${width}px`);
  navLensElement.classList.add("is-visible", "is-tracking");
  navLensTarget = null;
}

function syncNavLens(force = false) {
  if (!navElement || !navLensElement || navTracking) return;

  const target = navHoverLink || navPinnedLink || navElement.querySelector("a.is-active");
  if (!force && target === navLensTarget) return;

  navLensTarget = target;

  if (!target) {
    navLinks.forEach((link) => link.classList.remove("is-lens-target"));
    navLensElement.classList.remove("is-visible");
    return;
  }

  navLinks.forEach((link) => link.classList.toggle("is-lens-target", link === target));
  setNavLensPosition(target);
  navLensElement.classList.add("is-visible");
}

function navigateNavLink(link) {
  const href = link.getAttribute("href");
  if (!href || !href.startsWith("#")) return;

  if (window.location.hash !== href) {
    history.pushState(null, "", href);
  }

  const target = document.querySelector(href);
  if (target) {
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }
}

function setActiveNavLink(link) {
  navLinks.forEach((item) => {
    const active = item === link;
    item.classList.toggle("is-active", active);
    if (active) {
      item.setAttribute("aria-current", "location");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

function clearNavPin() {
  navPinnedLink = null;
  if (navPinTimer) {
    window.clearTimeout(navPinTimer);
    navPinTimer = null;
  }
}

/*
  点击菜单后先把药丸钉在目标项上，直到滚动把 active 状态也带到这里。
  否则滚动经过中间栏目时，药丸会先弹回旧的 active，再弹到目标。
*/
function pinNavLens(link) {
  if (!navElement || !navLensElement || !link) return;

  clearNavPin();
  navPinnedLink = link;
  navHoverLink = link;
  setActiveNavLink(link);
  syncNavLens();

  navPinTimer = window.setTimeout(() => {
    if (navPinnedLink !== link) return;
    navPinnedLink = null;
    navPinTimer = null;
    if (!navElement.matches(":hover")) navHoverLink = null;
    syncNavLens();
  }, 2000);
}

function setupNavLens() {
  if (!navElement || !navLensElement) return;

  const firstLink = navElement.querySelector("a");
  if (firstLink) setNavLensPosition(firstLink);

  let touchResetTimer = null;
  let touchState = null;
  let suppressNavClickUntil = 0;

  const clearTouchReset = () => {
    if (touchResetTimer) {
      window.clearTimeout(touchResetTimer);
      touchResetTimer = null;
    }
  };

  const scheduleTouchReset = () => {
    clearTouchReset();
    touchResetTimer = window.setTimeout(() => {
      navHoverLink = null;
      syncNavLens();
    }, 1000);
  };

  navElement.querySelectorAll("a").forEach((link) => {
    link.addEventListener("pointerenter", () => {
      if (navTracking) return;
      if (navPinnedLink && navPinnedLink !== link) clearNavPin();
      navHoverLink = link;
      syncNavLens();
    });
  });

  navElement.addEventListener("pointerdown", (event) => {
    // 新的一次按下意味着上一次拖动已经结束，不再拦截新的 click。
    suppressNavClickUntil = 0;

    if (event.pointerType === "mouse" || event.button !== 0 || touchState) return;

    const link = event.target.closest("a");
    if (!link || !navElement.contains(link)) return;

    clearTouchReset();
    touchState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      link,
    };

    navTracking = false;
    navHoverLink = link;
    navLinks.forEach((item) => item.classList.toggle("is-lens-target", item === link));
    setNavLensPosition(link);
    navLensElement.classList.remove("is-tracking");
    navLensElement.classList.add("is-visible");
  });

  navElement.addEventListener(
    "pointermove",
    (event) => {
      if (!touchState || event.pointerId !== touchState.pointerId || event.pointerType === "mouse") {
        return;
      }

      const dx = event.clientX - touchState.startX;
      const dy = event.clientY - touchState.startY;

      // 只把明显的横向拖动当成“在菜单里滑”，纵向仍然是正常滚动页面。
      if (!touchState.moved) {
        if (Math.abs(dx) < 5 || Math.abs(dx) <= Math.abs(dy)) return;
        touchState.moved = true;
        navTracking = true;
        navLensElement.classList.add("is-tracking");
      }

      setNavLensTracking(event.clientX);
    },
    { passive: true }
  );

  const endTouch = (event) => {
    if (!touchState || event.pointerId !== touchState.pointerId || event.pointerType === "mouse") {
      return;
    }

    const state = touchState;
    touchState = null;

    if (navTracking) {
      navTracking = false;
      navLensElement.classList.remove("is-tracking");

      if (state.moved && navHoverLink) {
        // 拖动结束后手动跳到选中的栏目，并吞掉随后浏览器可能补发的那次 click。
        suppressNavClickUntil = performance.now() + 650;
        pinNavLens(navHoverLink);
        navigateNavLink(navHoverLink);
      }

      syncNavLens(true);
      scheduleTouchReset();
      return;
    }

    // 普通点按：交给原生 click 完成跳转。
    navLensElement.classList.remove("is-tracking");
    syncNavLens(true);
    scheduleTouchReset();
  };

  const cancelTouch = (event) => {
    if (!touchState || event.pointerId !== touchState.pointerId) return;

    touchState = null;
    navTracking = false;
    navLensElement.classList.remove("is-tracking");
    navHoverLink = null;
    syncNavLens(true);
  };

  document.addEventListener("pointerup", endTouch, { passive: true });
  document.addEventListener("pointercancel", cancelTouch, { passive: true });

  // 拖动结束后浏览器偶尔还会补发一次 click，短暂拦截，避免重复跳转。
  navElement.addEventListener(
    "click",
    (event) => {
      if (performance.now() >= suppressNavClickUntil) return;
      const link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // 普通点击/键盘回车：药丸立刻落在被点的菜单项上，并保持到滚动结束。
  navElement.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link || !navElement.contains(link)) return;
    pinNavLens(link);
  });

  // 鼠标离开导航时回到当前栏目；触屏的收尾交给上面的定时器。
  navElement.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse" || navPinnedLink) return;
    navHoverLink = null;
    syncNavLens();
  });

  navElement.addEventListener("focusin", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    if (navPinnedLink && navPinnedLink !== link) clearNavPin();
    navHoverLink = link;
    syncNavLens();
  });

  navElement.addEventListener("focusout", (event) => {
    if (navElement.contains(event.relatedTarget)) return;
    navHoverLink = null;
    syncNavLens();
  });

  // 字体加载完成后重新量一次宽度。
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => syncNavLens(true)).catch(() => {});
  }
}

/*
  根据当前滚动位置高亮顶部导航。
  判断逻辑：哪个 section 的顶部已经进入视口上方 42% 以内，就认为当前在这个栏目。
*/
function updateActiveNav() {
  const links = [...navLinks];
  const atPageBottom =
    window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  const actualCurrent = atPageBottom
    ? links[links.length - 1]
    : links.findLast((link) => {
        const section = document.querySelector(link.getAttribute("href"));
        return section && section.getBoundingClientRect().top < window.innerHeight * 0.42;
      });
  const current = navPinnedLink || actualCurrent;

  setActiveNavLink(current);

  if (navPinnedLink && actualCurrent === navPinnedLink) {
    const wasPinned = navPinnedLink;
    clearNavPin();
    if (!navElement.matches(":hover") && navHoverLink === wasPinned) {
      navHoverLink = null;
    }
  }

  syncNavLens();
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

// 读取文本文件。这里主要用来读取 .md 内容。
// 静态服务器偶尔会重置并发连接，所以失败后自动重试两次，避免整栏内容因为一次网络抖动消失。
async function readText(path) {
  if (textFileCache.has(path)) return textFileCache.get(path);

  const separator = path.includes("?") ? "&" : "?";
  const url = `${path}${separator}v=${CONTENT_VERSION}`;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Cannot load ${path}`);
      const text = await response.text();
      textFileCache.set(path, text);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)));
    }
  }

  throw lastError;
}

// 单个文件失败时不让整个栏目失败：返回空字符串，卡片仍然显示标题和日期。
async function readTextSafe(path) {
  try {
    return await readText(path);
  } catch (error) {
    console.warn(`读取失败：${path}`, error);
    return "";
  }
}

/*
  读取自动生成的内容清单。
  重要：浏览器里的静态网页不能直接扫描文件夹，所以 generate-content-index.py
  会在你启动 blog 前把文件夹里真实存在的内容写到 window.BLOG_CONTENT。
  你平时只要增删 Markdown/图片，然后重新运行 start-blog.command 即可。
*/
async function loadContentIndex() {
  if (contentIndexCache) return contentIndexCache;

  // content-index.js 已经在页面头部同步加载，优先使用它，少一次网络请求。
  if (window.BLOG_CONTENT) {
    contentIndexCache = window.BLOG_CONTENT;
    return contentIndexCache;
  }

  try {
    contentIndexCache = JSON.parse(await readText("./content/content-index.json"));
    window.BLOG_CONTENT = contentIndexCache;
    return contentIndexCache;
  } catch (error) {
    console.warn("content-index.json 读取失败", error);
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
      const markdown = await readTextSafe(`./content/repos/${entry.file}`);
      return `
        <a class="content-link" href="${detailHref("repo", entry.file)}" data-reveal>
          <article class="repo-card">
            <span class="repo-status">${escapeHtml(entry.status)}</span>
            <h3>${escapeHtml(entry.title)}</h3>
            <div class="content-preview">${markdownToPreview(stripFirstHeading(markdown))}</div>
            <div class="card-cta">阅读全文 <span aria-hidden="true">↗</span></div>
          </article>
        </a>
      `;
    })
  );
  container.innerHTML = cards.join("");

  // 卡片是 JS 后生成的，生成后要再补一次滚动入场绑定。
  prepareReveal(container);
}

/*
  渲染笔记筛选按钮：每个类型后面带上数量，方便一眼看出内容分布。
*/
function renderNoteFilters(entries) {
  const container = document.querySelector(".note-filters");
  const types = [...new Set(entries.map((entry) => entry.type).filter(Boolean))];
  const countFor = (value) =>
    value === "all" ? entries.length : entries.filter((entry) => entry.type === value).length;
  const options = [{ label: "全部", value: "all" }, ...types.map((type) => ({ label: type, value: type }))];

  container.innerHTML = options
    .map((option) => {
      const active = option.value === activeNoteType ? "is-active" : "";
      return `
        <button class="${active}" type="button" data-note-filter="${escapeHtml(option.value)}">
          <span>${escapeHtml(option.label)}</span>
          <span class="filter-count">${countFor(option.value)}</span>
        </button>
      `;
    })
    .join("");
}

/*
  笔记卡片：日期 / 类型 / 阅读时间放在左栏，标题与摘要放在右栏。
  这样十则笔记可以像目录一样连续阅读，而不是十张同样大小的卡片。
*/
async function renderNoteCards(entries) {
  const container = document.querySelector(".note-grid");
  const cards = await Promise.all(
    entries.map(async (entry) => {
      const markdown = await readTextSafe(`./content/notes/${entry.file}`);
      const minutes = readingMinutes(markdown);
      return `
        <a class="content-link" href="${detailHref("note", entry.file)}" data-reveal>
          <article class="note-card">
            <h3>${escapeHtml(entry.title)}</h3>
            <p class="card-meta">
              <span class="meta-date">${escapeHtml(entry.date)}</span>
              ${entry.type ? `<span class="meta-type">${escapeHtml(entry.type)}</span>` : ""}
              <span class="meta-time">约 ${minutes} 分钟</span>
            </p>
            <div class="content-preview">${markdownToPreview(stripFirstHeading(markdown), 4)}</div>
          </article>
        </a>
      `;
    })
  );
  container.innerHTML =
    cards.join("") || `<div class="loading-row is-visible" data-reveal>这个类型下暂时没有笔记。</div>`;
  prepareReveal(container);
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
      const markdown = stripFrontmatter(await readTextSafe(`./content/gallery/${entry.file}`));
      const photoCount = (markdown.match(/^!\[/gm) || []).length;
      const cover = entry.cover || "";
      const coverSrc = cover ? `./content/gallery/${cover}` : "";
      const coverPreviewSrc = coverSrc ? galleryThumbnailSrc(coverSrc) : "";
      return `
        <a class="content-link gallery-item" href="${detailHref("gallery", entry.file)}" data-reveal>
          <figure>
            ${
              cover
                ? `<img src="${escapeHtml(coverPreviewSrc)}" data-fallback-src="${escapeHtml(coverSrc)}" alt="${escapeHtml(entry.title)}" loading="lazy" decoding="async" />`
                : ""
            }
            <figcaption>
              <div class="gallery-meta">
                <span>${escapeHtml(entry.date)}</span>
                <span>${escapeHtml(entry.place || "未标注地点")}</span>
                ${photoCount ? `<span>${photoCount} 张</span>` : ""}
              </div>
              <strong>${escapeHtml(entry.title)}</strong>
              <small>${markdownToPreview(stripFirstHeading(markdown), 2)}</small>
              <span class="gallery-cta">查看相册 <span aria-hidden="true">↗</span></span>
            </figcaption>
          </figure>
        </a>
      `;
    })
  );
  container.innerHTML = cards.join("");
  prepareReveal(container);
}

/*
  渲染最近更新：
  读取 content/updates 里的 Markdown 历史，生成主页底部的更新卡片。
  更新日志里的日期标题会被保留，避免只剩下没有时间上下文的条目。
*/
async function renderUpdates() {
  const container = document.querySelector(".update-grid");
  const entries = getContentIndex().updates;
  updatesData = entries;
  const cards = await Promise.all(
    entries.map(async (entry) => {
      const markdown = await readTextSafe(`./content/updates/${entry.file}`);
      return `
        <a class="content-link" href="${detailHref("update", entry.file)}" data-reveal>
          <article class="update-card">
            <p class="card-meta">${escapeHtml(entry.type)}</p>
            <h3>${escapeHtml(entry.title)}</h3>
            <div class="content-preview">${markdownToPreview(stripFirstHeading(markdown), 6, { dateHeadings: true })}</div>
            <div class="card-cta">查看更新日志 <span aria-hidden="true">↗</span></div>
          </article>
        </a>
      `;
    })
  );
  container.innerHTML = cards.join("");
  prepareReveal(container);
}

/*
  统计数字：个人区的三个数字，以及各栏目标题右侧的内容数量。
*/
function updateProfileStats() {
  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };

  setText('[data-stat="repos"]', String(reposData.length));
  setText('[data-stat="notes"]', String(notesData.length));
  setText('[data-stat="gallery"]', String(galleryData.length));

  const sectionCounts = {
    notes: notesData.length,
    repos: reposData.length,
    gallery: galleryData.length,
    updates: updatesData.length,
  };

  for (const [key, value] of Object.entries(sectionCounts)) {
    setText(`[data-section-count="${key}"]`, String(value).padStart(2, "0"));
  }
}

// 阅读进度：根据详情层自身滚动位置更新顶部 2px 红线。
function updateReaderProgress() {
  const reader = document.querySelector("#reader");
  const bar = reader?.querySelector(".reader-progress span");
  if (!reader || !bar) return;

  const max = reader.scrollHeight - reader.clientHeight;
  const progress = max > 0 ? Math.min(1, Math.max(0, reader.scrollTop / max)) : 0;
  bar.style.transform = `scaleX(${progress})`;
}

function setReader({ type, title, bodyHtml, backHref, meta = "" }) {
  closeImageLightbox({ immediate: true });
  const reader = document.querySelector("#reader");
  // 打开时直接显示阅读层，避免先铺一块和卡片同宽的过渡色块。
  const shouldMorphOpen = false;

  reader.querySelector(".reader-type").textContent = type;
  reader.querySelector(".reader-title").textContent = title;
  const metaElement = reader.querySelector(".reader-meta");
  if (metaElement) metaElement.textContent = meta;
  reader.querySelector(".reader-body").innerHTML = bodyHtml;
  reader.querySelector(".reader-back").setAttribute("href", backHref);
  reader.classList.toggle("is-opening-from-card", Boolean(shouldMorphOpen));
  document.body.classList.add("is-reader-open");
  document.body.classList.remove("is-header-hidden");
  reader.classList.add("is-open");
  reader.setAttribute("aria-hidden", "false");
  reader.inert = false;
  if (pageShell) pageShell.inert = true;
  document.title = `${title} — ${BASE_TITLE}`;
  reader.scrollTop = 0;
  updateReaderProgress();

  // 把焦点交给标题，屏幕阅读器会先读出文章名；关闭时再回到原来的卡片。
  const titleElement = reader.querySelector(".reader-title");
  titleElement.setAttribute("tabindex", "-1");
  requestAnimationFrame(() => titleElement.focus({ preventScroll: true }));

  if (shouldMorphOpen) {
    animateReaderOpen(reader);
    // 动画异常时的兜底，避免阅读面板一直停在过渡层后面。
    window.setTimeout(() => reader.classList.remove("is-opening-from-card"), 700);
  } else {
    pendingOpenRect = null;
  }
}

function hideReader() {
  const reader = document.querySelector("#reader");
  const returnLink = currentOpenSource?.href ? findCurrentDetailLink(currentOpenSource.href) : null;

  reader.classList.remove("is-opening-from-card");
  reader.classList.remove("is-open");
  reader.setAttribute("aria-hidden", "true");
  reader.inert = true;
  closeImageLightbox({ immediate: true });
  document.body.classList.remove("is-reader-open");
  document.body.classList.remove("is-header-hidden");
  if (pageShell) pageShell.inert = false;
  document.title = BASE_TITLE;

  if (returnLink) {
    requestAnimationFrame(() => returnLink.focus({ preventScroll: true }));
  }
}

function getImageLightbox() {
  let lightbox = document.querySelector(".image-lightbox");
  if (lightbox) return lightbox;

  lightbox = document.createElement("div");
  lightbox.className = "image-lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "查看原图");
  lightbox.setAttribute("aria-hidden", "true");
  lightbox.innerHTML = `
    <div class="image-lightbox__backdrop"></div>
    <button class="image-lightbox__close" type="button" aria-label="关闭原图查看">×</button>
    <img class="image-lightbox__image" alt="" />
  `;
  document.body.append(lightbox);
  return lightbox;
}

// 使用预览图的位置做缩放动画，原图加载完成后再替换，避免等待或闪白。
function sizeLightboxImage(session) {
  const padding = parseFloat(getComputedStyle(session.lightbox).paddingTop) * 2;
  const width = Math.min(window.innerWidth - padding, (window.innerHeight - padding) * session.ratio);
  session.image.style.width = `${Math.max(1, width)}px`;
  session.image.style.height = `${Math.max(1, width / session.ratio)}px`;
}

function lightboxSourceTransform(image, sourceRect) {
  const rect = image.getBoundingClientRect();
  return `translate(${sourceRect.left - rect.left}px, ${sourceRect.top - rect.top}px) scale(${sourceRect.width / rect.width}, ${sourceRect.height / rect.height})`;
}

function animateLightbox(session, frames, duration) {
  session.animations = frames.map(([element, keyframes]) => element.animate(keyframes, {
    duration,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "both",
  }));
  return Promise.all(session.animations.map((animation) => animation.finished.catch(() => {})));
}

function cancelLightboxAnimations(session) {
  session.animations.forEach((animation) => animation.cancel());
  session.animations = [];
}

function openImageLightbox(src, alt = "", sourceButton = null) {
  closeImageLightbox({ immediate: true });
  const lightbox = getImageLightbox();
  const image = lightbox.querySelector(".image-lightbox__image");
  const source = sourceButton?.querySelector("img");
  const sourceRect = source?.getBoundingClientRect();
  const hasSource = sourceRect?.width > 0 && sourceRect?.height > 0;
  const session = {
    lightbox, image, source, sourceButton,
    backdrop: lightbox.querySelector(".image-lightbox__backdrop"),
    closeButton: lightbox.querySelector(".image-lightbox__close"),
    ratio: source?.naturalWidth ? source.naturalWidth / source.naturalHeight : hasSource ? sourceRect.width / sourceRect.height : 1,
    animations: [],
    closing: false,
  };
  imageLightboxSession = session;
  image.src = source?.currentSrc || src;
  image.alt = alt;
  sizeLightboxImage(session);
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-lightbox-open");
  source?.classList.add("is-lightbox-source");

  // 灯箱打开时，把阅读层也设为 inert，Tab 不会跑到背后的正文里。
  const reader = document.querySelector("#reader");
  if (reader?.classList.contains("is-open")) reader.inert = true;

  session.closeButton.focus({ preventScroll: true });

  if (!prefersReducedMotion()) {
    animateLightbox(session, [
      [image, [{ transform: hasSource ? lightboxSourceTransform(image, sourceRect) : "scale(0.96)" }, { transform: "none" }]],
      [session.backdrop, [{ opacity: 0 }, { opacity: 1 }]],
      [session.closeButton, [{ opacity: 0 }, { opacity: 1 }]],
    ], 320).then(() => {
      if (imageLightboxSession === session && !session.closing) cancelLightboxAnimations(session);
    });
  }

  const original = new Image();
  original.src = src;
  original.decode().then(() => {
    if (imageLightboxSession === session && !session.closing) image.src = src;
  }).catch(() => {}); // 原图失败时仍保留可见的预览图。
}

function closeImageLightbox({ immediate = false } = {}) {
  const session = imageLightboxSession;
  if (!session || (session.closing && !immediate)) return;

  const finish = () => {
    if (imageLightboxSession !== session) return;
    cancelLightboxAnimations(session);
    session.lightbox.classList.remove("is-open");
    session.lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-lightbox-open");

    const reader = document.querySelector("#reader");
    if (reader?.classList.contains("is-open")) reader.inert = false;

    session.source?.classList.remove("is-lightbox-source");
    session.image.removeAttribute("src");
    session.image.alt = "";
    imageLightboxSession = null;
    if (!immediate && session.sourceButton?.isConnected) session.sourceButton.focus({ preventScroll: true });
  };

  session.closing = true;
  if (immediate || prefersReducedMotion()) {
    finish();
    return;
  }

  // 中途点击关闭时从当前动画帧折返，不跳到完全放大后的状态。
  const transform = getComputedStyle(session.image).transform;
  const backdropOpacity = getComputedStyle(session.backdrop).opacity;
  const buttonOpacity = getComputedStyle(session.closeButton).opacity;
  cancelLightboxAnimations(session);
  const sourceRect = session.source?.isConnected ? session.source.getBoundingClientRect() : null;
  const hasTarget = sourceRect?.width > 0 && sourceRect?.height > 0 && sourceRect.bottom > 0 && sourceRect.top < window.innerHeight;
  animateLightbox(session, [
    [session.image, [
      { transform, opacity: 1 },
      { transform: hasTarget ? lightboxSourceTransform(session.image, sourceRect) : "scale(0.96)", opacity: hasTarget ? 1 : 0 },
    ]],
    [session.backdrop, [{ opacity: backdropOpacity }, { opacity: 0 }]],
    [session.closeButton, [{ opacity: buttonOpacity }, { opacity: 0 }]],
  ], 260).then(finish);
}

// 更新日志的类型在 Markdown 文件名里是 content / template，这里换成中文再展示。
const UPDATE_TYPE_LABELS = { content: "内容更新", template: "模板更新" };

async function openMarkdownDetail(kind, file) {
  const isNote = kind === "note";
  const isUpdate = kind === "update";
  const entries = isNote ? notesData : isUpdate ? updatesData : reposData;
  const entry = entries.find((item) => item.file === file);
  if (!entry) return;

  const folder = isNote ? "notes" : isUpdate ? "updates" : "repos";
  const markdown = await readTextSafe(`./content/${folder}/${file}`);
  const body = markdown
    ? markdownToHtml(stripFirstHeading(markdown))
    : "<p>内容暂时无法读取，请刷新页面或重新运行 start-blog.command。</p>";

  let meta = "";
  if (isNote) {
    meta = `${entry.date} · ${entry.type} · 约 ${readingMinutes(markdown)} 分钟`;
  } else if (isUpdate) {
    meta = `${UPDATE_TYPE_LABELS[entry.type] || entry.type} · 更新日志`;
  } else {
    meta = `${entry.status} · 项目记录`;
  }

  setReader({
    type: isNote ? "Note" : isUpdate ? "Update" : "Repository",
    title: entry.title,
    meta,
    // 详情页顶部已经有 reader-title，这里去掉 Markdown 第一行 H1，避免标题重复显示。
    bodyHtml: body,
    backHref: isNote ? "#notes" : isUpdate ? "#updates" : "#repos",
  });
}

async function openGalleryDetail(file) {
  const entry = galleryData.find((item) => item.file === file);
  if (!entry) return;

  const markdown = stripFrontmatter(await readTextSafe(`./content/gallery/${file}`));
  const photoCount = (markdown.match(/^!\[/gm) || []).length;
  const body = markdown
    ? markdownToHtml(stripFirstHeading(markdown), { imageBasePath: "./content/gallery/" })
    : "<p>相册内容暂时无法读取，请刷新页面或重新运行 start-blog.command。</p>";

  setReader({
    type: "Gallery",
    title: entry.title,
    meta: [entry.date, entry.place, photoCount ? `${photoCount} 张照片` : ""].filter(Boolean).join(" · "),
    bodyHtml: body,
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

  // 动画结束后再把焦点还给原卡片；history.back 会重设焦点，所以放在最后一步。
  if (targetLink?.isConnected) targetLink.focus({ preventScroll: true });
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
  点击涟漪：在点击位置生成一圈光，让按下动作也有“液态玻璃”的反馈。
  光斑会裁切在卡片/按钮自身的圆角里，动画结束后自动移除。
*/
const TAP_SELECTOR = ".content-link, .button, .note-filters button, .theme-toggle, .reader-back, .primary-nav a";

function findRippleSurface(target) {
  if (target.matches(".content-link")) {
    return target.querySelector(".note-card, .repo-card, .update-card, .gallery-item figure") || target;
  }
  return target;
}

document.addEventListener(
  "pointerdown",
  (event) => {
    if (event.button !== 0 || prefersReducedMotion()) return;
    // 手指按下通常是要滚动页面，不要在卡片上留下白色光斑。
    if (event.pointerType === "touch") return;

    const target = event.target.closest(TAP_SELECTOR);
    if (!target) return;

    const surface = findRippleSurface(target);
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const size = Math.min(620, Math.max(rect.width, rect.height) * 1.05);
    const ripple = document.createElement("span");
    ripple.className = "tap-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    surface.append(ripple);

    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  },
  { passive: true }
);

/*
  “耐操”的注释卡：桌面悬停由 CSS 负责，
  这里补上点击切换和点击空白/按 Esc 关闭，方便触屏和键盘。
*/
function setupTermTip() {
  const term = document.querySelector(".term");
  if (!term) return;

  const close = () => term.setAttribute("aria-expanded", "false");

  term.addEventListener("click", (event) => {
    event.preventDefault();
    term.setAttribute("aria-expanded", String(term.getAttribute("aria-expanded") !== "true"));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".term-wrap")) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

document.addEventListener("click", (event) => {
  const imageButton = event.target.closest("[data-lightbox-src]");
  if (imageButton) {
    event.preventDefault();
    openImageLightbox(imageButton.getAttribute("data-lightbox-src"), imageButton.getAttribute("data-lightbox-alt") || "", imageButton);
    return;
  }

  if (event.target.closest(".image-lightbox")) {
    event.preventDefault();
    closeImageLightbox();
    return;
  }

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

document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;

    // 缩略图 404 时退回原图；只尝试一次，避免死循环。
    const fallbackSrc = image.dataset.fallbackSrc;
    if (!fallbackSrc || image.dataset.fallbackApplied) return;
    image.dataset.fallbackApplied = "1";
    image.src = fallbackSrc;
  },
  true
);

// 窗口尺寸变化时只处理灯箱尺寸；页面滚动时更新导航高亮。
window.addEventListener("resize", () => {
  if (imageLightboxSession?.closing) {
    closeImageLightbox({ immediate: true });
  } else if (imageLightboxSession) {
    cancelLightboxAnimations(imageLightboxSession);
    sizeLightboxImage(imageLightboxSession);
  }
  updateReaderProgress();
  syncNavLens(true);
});
window.addEventListener("scroll", handlePageScroll, { passive: true });
window.addEventListener("hashchange", handleRoute);
window.addEventListener("popstate", handleRoute);

// Esc：先关灯箱，再关阅读层。
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (imageLightboxSession) {
    closeImageLightbox();
    return;
  }

  if (isReaderOpen()) {
    const backHref = document.querySelector(".reader-back")?.getAttribute("href") || "#notes";
    animateReaderClose(backHref);
  }
});

document.querySelector("#reader")?.addEventListener("scroll", updateReaderProgress, { passive: true });

/*
  初始化顺序：
  1. 确认主题开关状态。
  2. 给 HTML 里已有元素绑定滚动入场。
  3. 更新一次导航状态。
  4. 读取内容文件并渲染笔记、仓库、相册、更新。
*/
setupThemeToggle();
setupTermTip();
setupNavLens();
prepareReveal();
updateActiveNav();
renderContent();
