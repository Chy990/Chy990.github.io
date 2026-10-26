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
const siteHeader = document.querySelector(".site-header");
const headerActions = document.querySelector(".header-actions");
const navDock = document.querySelector(".nav-dock");
const readerSection = document.querySelector("#reader");
const readerBarElement = document.querySelector(".reader-bar");
const readerBarDock = document.querySelector(".reader-bar-dock");
const CONTENT_VERSION = "20261021-57";
const BASE_TITLE = "Chen 的实验台";

// WeakSet 用来记录哪些元素已经绑定过观察器，避免重复绑定。
const observedRevealItems = new WeakSet();
let notesData = [];
let reposData = [];
let galleryData = [];
let updatesData = [];
let currentOpenSource = null;
let readerMotion = null;
let readerSettleTimer = 0;
let lastReaderRecoveryAt = 0;
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
let navLastPointerType = "";
let navScrollFrame = 0;
let navScrollCleanup = null;
let imageLightboxSession = null;
let readerBarMotion = null;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/*
  手机端把主导航放到底部，iPad 再把它固定到左下角；桌面端完全不变。
  这里优先看设备类型，而不是只依赖宽度，避免 iPad 横屏时又跑回顶部。
*/
function detectIPad() {
  const ua = navigator.userAgent || "";
  if (/iPad/.test(ua)) return true;
  // iPadOS 13 起默认伪装成 Mac，只能靠多点触控判断。
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

const isIPadDevice = detectIPad();
const narrowNavQuery = window.matchMedia("(max-width: 640px)");
const touchNavQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
const wideTouchQuery = window.matchMedia("(max-width: 900px)");

if (isIPadDevice) document.documentElement.classList.add("is-ipad");

function shouldDockNav() {
  if (isIPadDevice) return true;
  if (narrowNavQuery.matches) return true;
  // 手机横屏后宽度会超过 640px，触屏设备仍然把导航放到底部。
  return touchNavQuery.matches && wideTouchQuery.matches;
}

function isNavDocked() {
  return document.body.classList.contains("nav-docked");
}

/*
  详情导航条与底部主导航的过渡：
  两者在手机上都位于正下方，在 iPad 上都位于左下角，所以进入详情时
  让 reader-bar 从主导航的矩形“长”出来，退出时再缩回主导航的位置。
*/
function clearReaderBarStyles() {
  if (!readerBarElement) return;
  readerBarElement.style.transform = "";
  readerBarElement.style.transformOrigin = "";
  readerBarElement.style.opacity = "";
  readerBarElement.style.visibility = "";
}

function cancelReaderBarMotion() {
  if (readerBarMotion) {
    const animation = readerBarMotion;
    readerBarMotion = null;
    animation.cancel();
  }
  clearReaderBarStyles();
}

// 把 toRect 的布局映射成 fromRect 的视觉矩形，供 FLIP 动画使用。
function barRectTransform(fromRect, toRect) {
  const scaleX = fromRect.width / toRect.width;
  const scaleY = fromRect.height / toRect.height;
  const translateX = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
  const translateY = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
  return `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
}

function animateReaderBarIn() {
  if (!isNavDocked() || !readerBarElement || !navElement) return;

  cancelReaderBarMotion();
  if (prefersReducedMotion()) return;

  const barRect = readerBarElement.getBoundingClientRect();
  const navRect = navElement.getBoundingClientRect();
  if (barRect.width < 1 || navRect.width < 1) return;

  readerBarElement.style.transformOrigin = "50% 50%";
  const animation = readerBarElement.animate(
    [
      { transform: barRectTransform(navRect, barRect), opacity: 0.4 },
      { transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 },
    ],
    { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" }
  );
  readerBarMotion = animation;

  animation.finished.catch(() => {}).then(() => {
    if (readerBarMotion !== animation) return;
    readerBarMotion = null;
    animation.cancel();
    clearReaderBarStyles();
  });
}

function animateReaderBarOut() {
  if (!isNavDocked() || !readerBarElement || !navElement) return;

  // 如果入场动画还没结束，从它当前停留的位置继续，避免返回时闪一下。
  const startRect = readerBarElement.getBoundingClientRect();
  const startOpacity = Number.parseFloat(getComputedStyle(readerBarElement).opacity);
  cancelReaderBarMotion();

  const layoutRect = readerBarElement.getBoundingClientRect();
  const navRect = navElement.getBoundingClientRect();
  if (prefersReducedMotion() || layoutRect.width < 1 || navRect.width < 1) return;

  readerBarElement.style.transformOrigin = "50% 50%";
  const animation = readerBarElement.animate(
    [
      {
        transform: barRectTransform(startRect, layoutRect),
        opacity: Number.isFinite(startOpacity) ? startOpacity : 1,
      },
      { transform: barRectTransform(navRect, layoutRect), opacity: 0 },
    ],
    { duration: 320, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "both" }
  );
  readerBarMotion = animation;

  animation.finished.catch(() => {}).then(() => {
    if (readerBarMotion !== animation) return;
    readerBarMotion = null;
    animation.cancel();
    // 保持透明，等 hideReader 移除 is-reader-open 后再彻底隐藏。
    readerBarElement.style.transform = "";
    readerBarElement.style.transformOrigin = "";
    readerBarElement.style.opacity = "0";
  });
}

// 阅读层或灯箱打开时，底部导航不应该还能被 Tab 或误触到。
function syncNavDockInert() {
  const readerOpen = document.body.classList.contains("is-reader-open");
  const lightboxOpen = document.body.classList.contains("is-lightbox-open");

  if (navDock) navDock.inert = readerOpen || lightboxOpen;
  // 详情导航条在移动端被移到了 reader 外面，需要单独控制可交互状态。
  if (readerBarDock) readerBarDock.inert = !readerOpen || lightboxOpen;
}

function syncNavPlacement() {
  if (!navElement || !navDock || !siteHeader) return;

  const docked = shouldDockNav();
  // 先让底部容器显示，再移动节点；否则在 display: none 的容器里量到的是 0。
  document.body.classList.toggle("nav-docked", docked);
  document.body.classList.toggle("nav-dock-ipad", docked && isIPadDevice);

  const targetParent = docked ? navDock : siteHeader;
  if (navElement.parentElement !== targetParent) {
    if (docked) {
      navDock.append(navElement);
    } else {
      siteHeader.insertBefore(navElement, headerActions || null);
    }
    // 菜单位置换了，药丸的位置和宽度都要重新量。
    measureNavLinks();
    navLensTarget = null;
    syncNavLens(true);
  }

  // 详情导航条也跟随设备模式切换父容器，移动端才能做底部过渡动画。
  if (readerBarElement && readerBarDock && readerSection) {
    const barParent = docked ? readerBarDock : readerSection;
    if (readerBarElement.parentElement !== barParent) {
      cancelReaderBarMotion();
      if (docked) {
        readerBarDock.append(readerBarElement);
      } else {
        readerSection.insertBefore(readerBarElement, readerSection.firstChild);
      }
    }
  }

  syncNavDockInert();
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
/*
  导航项的 offsetLeft / offsetWidth 只在窗口尺寸或字体变化时才会变。
  缓存起来，滚动回调里就不用读这些会触发布局的属性。
*/
let navLinkMetrics = [];

function measureNavLinks() {
  navLinkMetrics = [...navLinks].map((link) => ({
    link,
    left: link.offsetLeft,
    width: link.offsetWidth,
  }));
}

function navLinkMetric(link) {
  return navLinkMetrics.find((item) => item.link === link) || null;
}

function setNavLensPosition(link) {
  if (!navLensElement || !link) return;
  const metric = navLinkMetric(link);
  if (!metric) return;
  navLensElement.style.setProperty("--lens-x", `${metric.left}px`);
  navLensElement.style.setProperty("--lens-w", `${metric.width}px`);
  navLensElement.style.setProperty("--lens-stretch", "0");
}

/*
  触屏拖动时药丸不再直接“钉”在手指上，而是用一个很小的弹簧跟着手指走：
  既保持跟手，又有真实的滞后、惯性和一点点回弹，和桌面端鼠标悬停时的
  spring 手感保持一致。

  三种阶段用不同刚度：
  - press：刚按下，快速贴到按到的菜单项；
  - drag：跟手拖动，阻尼略低，药丸会被手指“带”着走；
  - settle：松手后落位，阻尼更低，收尾带一点回弹。
*/
const NAV_LENS_SPRINGS = {
  press: { stiffness: 720, damping: 54 },
  drag: { stiffness: 520, damping: 38 },
  settle: { stiffness: 330, damping: 19 },
};

const navLensMotion = {
  frame: 0,
  lastTime: 0,
  x: 0,
  width: 0,
  vx: 0,
  vw: 0,
  targetX: 0,
  targetWidth: 0,
  clientX: null,
  navRect: null,
  phase: "",
  link: null,
};

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 药丸允许出现的横向范围（相对导航轨道）。
function navLensBounds(width) {
  if (!navLinkMetrics.length) return null;
  const first = navLinkMetrics[0];
  const last = navLinkMetrics[navLinkMetrics.length - 1];
  return {
    min: first.left,
    max: Math.max(first.left, last.left + last.width - width),
  };
}

// 读取药丸此刻真正画在哪儿（可能正处在 CSS 过渡中间），让弹簧从这里接着走。
function readNavLensVisual() {
  if (!navElement || !navLensElement) return null;
  const navRect = navElement.getBoundingClientRect();
  const lensRect = navLensElement.getBoundingClientRect();
  if (lensRect.width < 1) return null;
  return {
    navRect,
    x: lensRect.left - navRect.left - navElement.clientLeft,
    width: lensRect.width,
  };
}

/*
  把手指的横坐标映射成药丸目标：中心跟手，但限制在导航轨道内；
  宽度取最近菜单项的宽度，文字缩放也落到最近项上。

  导航容器位置在按下时缓存一次，指针移动过程中不再读布局。
*/
function navLensDragTarget(clientX, navRect) {
  if (!navElement || !navRect || !navLinkMetrics.length) return null;

  const localX = clientX - navRect.left - navElement.clientLeft;

  let nearestMetric = navLinkMetrics[0];
  let nearestDistance = Infinity;

  for (const metric of navLinkMetrics) {
    const center = metric.left + metric.width / 2;
    const distance = Math.abs(localX - center);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestMetric = metric;
    }
  }

  const width = nearestMetric.width;
  const bounds = navLensBounds(width);
  const left = clampNumber(localX - width / 2, bounds.min, bounds.max);

  return { left, width, link: nearestMetric.link };
}

function renderNavLensMotion() {
  if (!navLensElement) return;
  const motion = navLensMotion;
  // 速度越快，药丸沿运动方向略微拉长，形成一点点“液体”拉伸。
  // 拉伸交给内层的 scaleX 做，避免每帧改变 width 触发重排 / 重绘阴影。
  const stretch = clampNumber(motion.vx * 0.00018, -0.12, 0.12);
  navLensElement.style.setProperty("--lens-x", `${motion.x}px`);
  navLensElement.style.setProperty("--lens-w", `${motion.width}px`);
  navLensElement.style.setProperty("--lens-stretch", stretch.toFixed(4));
}

function stopNavLensLoop() {
  if (!navLensMotion.frame) return;
  window.cancelAnimationFrame(navLensMotion.frame);
  navLensMotion.frame = 0;
}

function startNavLensLoop() {
  if (navLensMotion.frame || !navLensMotion.phase) return;
  navLensMotion.lastTime = 0;
  navLensMotion.frame = window.requestAnimationFrame(stepNavLensMotion);
}

function navLensMotionSettled() {
  const motion = navLensMotion;
  return (
    Math.abs(motion.x - motion.targetX) < 0.2 &&
    Math.abs(motion.vx) < 2 &&
    Math.abs(motion.width - motion.targetWidth) < 0.2 &&
    Math.abs(motion.vw) < 2
  );
}

function stepNavLensMotion(now) {
  navLensMotion.frame = 0;
  if (!navLensMotion.phase) return;

  const motion = navLensMotion;
  if (!motion.lastTime) motion.lastTime = now;
  // 切后台再回来时 dt 会很大，夹住上限，避免弹簧一步跳飞。
  const dt = clampNumber((now - motion.lastTime) / 1000, 0.001, 0.04);
  motion.lastTime = now;

  // pointermove 只记录坐标；目标与样式统一在每帧里算，最多每帧写一次。
  if (motion.phase === "drag" && motion.clientX != null) {
    const target = navLensDragTarget(motion.clientX, motion.navRect);
    if (target) {
      motion.targetX = target.left;
      motion.targetWidth = target.width;
      if (target.link !== motion.link) {
        motion.link = target.link;
        navHoverLink = target.link;
        navLinks.forEach((item) => item.classList.toggle("is-lens-target", item === target.link));
      }
    }
  }

  if (prefersReducedMotion()) {
    motion.x = motion.targetX;
    motion.width = motion.targetWidth;
    motion.vx = 0;
    motion.vw = 0;
  } else {
    const spring = NAV_LENS_SPRINGS[motion.phase] || NAV_LENS_SPRINGS.drag;

    motion.vx +=
      (-spring.stiffness * (motion.x - motion.targetX) - spring.damping * motion.vx) * dt;
    motion.x += motion.vx * dt;

    motion.vw +=
      (-spring.stiffness * (motion.width - motion.targetWidth) - spring.damping * motion.vw) * dt;
    motion.width += motion.vw * dt;
  }

  // 撞到导航轨道两端时停住，交给弹簧自己收回来。
  const bounds = navLensBounds(motion.width);
  if (bounds) {
    if (motion.x < bounds.min) {
      motion.x = bounds.min;
      if (motion.vx < 0) motion.vx = 0;
    } else if (motion.x > bounds.max) {
      motion.x = bounds.max;
      if (motion.vx > 0) motion.vx = 0;
    }
  }

  renderNavLensMotion();

  if (navLensMotionSettled()) {
    if (motion.phase === "settle") {
      finishNavLensMotion();
      syncNavLens(true);
    } else {
      // 按住不动、或拖到某处停住时停掉循环省电；下一次移动会重新启动。
      motion.x = motion.targetX;
      motion.width = motion.targetWidth;
      motion.vx = 0;
      motion.vw = 0;
      renderNavLensMotion();
      stopNavLensLoop();
    }
    return;
  }

  motion.frame = window.requestAnimationFrame(stepNavLensMotion);
}

// 按下的瞬间用一段很快的弹簧贴到目标项，避免连续点按时药丸硬切。
function beginNavLensGesture(link) {
  if (!navElement || !navLensElement || !link) return;

  const metric = navLinkMetric(link);
  if (!metric) return;

  if (!navLensMotion.phase) {
    const visible = navLensElement.classList.contains("is-visible");
    const visual = visible ? readNavLensVisual() : null;
    navLensMotion.x = visual ? visual.x : metric.left;
    navLensMotion.width = visual ? visual.width : metric.width;
    if (!visible) {
      // 药丸原本是隐藏的：先把位置放好再淡入，避免第一帧从旧栏目闪过去。
      navLensElement.style.setProperty("--lens-x", `${metric.left}px`);
      navLensElement.style.setProperty("--lens-w", `${metric.width}px`);
      navLensElement.style.setProperty("--lens-stretch", "0");
    }
  }

  // 不管上一次手势有没有收完，新的一次按下都从当前位置重新出发。
  navLensMotion.navRect = navElement.getBoundingClientRect();
  navLensMotion.vx = 0;
  navLensMotion.vw = 0;
  navLensMotion.phase = "press";
  navLensMotion.lastTime = 0;
  navLensMotion.clientX = null;
  navLensMotion.link = link;
  navLensMotion.targetX = metric.left;
  navLensMotion.targetWidth = metric.width;

  navLensElement.classList.remove("is-dragging");
  navLensElement.classList.add("is-visible", "is-tracking", "is-pressed");
  navElement.classList.add("is-tracking");
  navLinks.forEach((item) => item.classList.toggle("is-lens-target", item === link));
  navLensTarget = null;

  startNavLensLoop();
}

// 松手后带着一点回弹落到某个菜单项上。
function settleNavLensTo(link) {
  const metric = navLinkMetric(link);
  if (!metric) {
    finishNavLensMotion();
    return;
  }

  /*
    松手就立刻收回“拖动放大”状态：玻璃面按 150ms 的过渡迅速恢复原尺寸，
    药丸位置仍然由下面的弹簧继续滑到目标项。两者解耦，不会有“先等它滑完
    再慢慢变小”的迟滞感。
  */
  navLensElement.classList.remove("is-dragging", "is-pressed");
  navLensElement.style.setProperty("--lens-stretch", "0");

  navLensMotion.phase = "settle";
  navLensMotion.clientX = null;
  navLensMotion.link = link;
  // 保留松手时的惯性，但夹住上限，避免快速甩动时药丸冲过好几个栏目。
  navLensMotion.vx = clampNumber(navLensMotion.vx, -900, 900);
  navLensMotion.vw = 0;
  navLensMotion.targetX = metric.left;
  navLensMotion.targetWidth = metric.width;
  navLinks.forEach((item) => item.classList.toggle("is-lens-target", item === link));
  startNavLensLoop();
}

// 手势被系统打断（例如开始纵向滚动页面）时，让药丸弹回当前栏目。
function cancelNavLensGesture() {
  if (!navLensMotion.phase) {
    syncNavLens(true);
    return;
  }

  const target = navPinnedLink || navElement?.querySelector("a.is-active") || null;
  if (target) {
    settleNavLensTo(target);
  } else {
    finishNavLensMotion();
    syncNavLens(true);
  }
}

function finishNavLensMotion() {
  stopNavLensLoop();

  const motion = navLensMotion;
  motion.phase = "";
  motion.clientX = null;
  motion.lastTime = 0;
  motion.vx = 0;
  motion.vw = 0;

  if (navLensElement) {
    motion.x = motion.targetX;
    motion.width = motion.targetWidth;
    navLensElement.style.setProperty("--lens-x", `${motion.targetX}px`);
    navLensElement.style.setProperty("--lens-w", `${motion.targetWidth}px`);
    navLensElement.style.setProperty("--lens-stretch", "0");
    navLensElement.classList.remove("is-tracking", "is-dragging", "is-pressed");
  }
  if (navElement) navElement.classList.remove("is-tracking");
  navLensTarget = motion.link;
}

function syncNavLens(force = false) {
  if (!navElement || !navLensElement) return;

  if (navLensMotion.phase) {
    if (!force) return;
    // 尺寸 / 位置变了：先让弹簧停下，再按新的布局重新定位。
    finishNavLensMotion();
  }

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

function cancelNavScrollAnimation() {
  if (navScrollFrame) {
    window.cancelAnimationFrame(navScrollFrame);
    navScrollFrame = 0;
  }
  if (navScrollCleanup) {
    const cleanup = navScrollCleanup;
    navScrollCleanup = null;
    cleanup();
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/*
  手机 / iPad 上从菜单跳到栏目时，原生 smooth 只有一条固定曲线，
  距离一长就显得急、刹车也硬。这里用一条更长的缓入缓出曲线逐帧滚动，
  并按“落点上方会不会出现页头”留出不同高度的呼吸位。

  桌面端仍然使用原生平滑滚动，不改变原来的手感。
*/
function scrollToSectionSmoothly(section) {
  cancelNavScrollAnimation();

  const startY = window.scrollY;
  const sectionTop = startY + section.getBoundingClientRect().top;
  const headerHeight = siteHeader ? siteHeader.getBoundingClientRect().height : 0;
  // 往下滚时页头会收起，落点只需要一点点呼吸位；往上滚时页头会重新出现，
  // 必须把它的高度算进去，否则标题会被玻璃页头盖住。
  // iPad（>640px）的页头被 CSS 固定在顶部、不会收起，所以始终要留出高度。
  const willScrollDown = sectionTop > startY + 1;
  const headerStaysOpen = window.innerWidth >= 641;
  const headerWillShow = headerStaysOpen || !willScrollDown || sectionTop < 90;
  const topInset = headerWillShow ? headerHeight + 18 : 20;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const targetY = clampNumber(sectionTop - topInset, 0, maxScroll);
  const distance = targetY - startY;

  if (Math.abs(distance) < 2) return;

  if (prefersReducedMotion()) {
    const html = document.documentElement;
    const previousScrollBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    window.scrollTo(0, targetY);
    html.style.scrollBehavior = previousScrollBehavior;
    return;
  }

  // 距离越远滑得越久，但始终控制在 320–980ms，不会让人等得不耐烦。
  const duration = clampNumber(320, 980, 260 + Math.sqrt(Math.abs(distance)) * 11);
  const startedAt = performance.now();
  const html = document.documentElement;
  const previousScrollBehavior = html.style.scrollBehavior;
  // 逐帧 scrollTo 时必须关掉 CSS 的 smooth，否则每次调用都会再起一段动画。
  html.style.scrollBehavior = "auto";

  const onInterrupt = () => cancelNavScrollAnimation();
  const onKeyDown = () => cancelNavScrollAnimation();
  const onPointerDown = (event) => {
    // 触屏由上面的 touchstart 负责；这里只处理鼠标 / 触控笔，
    // 避免把触屏拖动后浏览器补发的兼容鼠标事件当成新的用户操作。
    if (event.pointerType === "touch") return;
    cancelNavScrollAnimation();
  };
  const onVisibilityChange = () => {
    if (document.hidden) cancelNavScrollAnimation();
  };

  navScrollCleanup = () => {
    window.removeEventListener("touchstart", onInterrupt, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("wheel", onInterrupt, true);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    html.style.scrollBehavior = previousScrollBehavior;
  };

  // 用户一旦自己碰页面，立刻把控制权还给他。
  window.addEventListener("touchstart", onInterrupt, { passive: true, capture: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
  window.addEventListener("wheel", onInterrupt, { passive: true, capture: true });
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("visibilitychange", onVisibilityChange);

  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    window.scrollTo(0, startY + distance * easeInOutCubic(progress));

    if (progress < 1) {
      navScrollFrame = window.requestAnimationFrame(tick);
    } else {
      navScrollFrame = 0;
      window.scrollTo(0, targetY);
      cancelNavScrollAnimation();
    }
  };

  navScrollFrame = window.requestAnimationFrame(tick);
}

function navigateNavLink(link) {
  const href = link.getAttribute("href");
  if (!href || !href.startsWith("#")) return;

  if (window.location.hash !== href) {
    history.pushState(null, "", href);
  }

  const target = document.querySelector(href);
  if (!target) return;

  if (isNavDocked()) {
    scrollToSectionSmoothly(target);
    return;
  }

  cancelNavScrollAnimation();
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
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
  // 触屏没有真正的 hover：药丸靠 pin 固定，避免 :hover 残留把药丸粘在旧栏目上。
  navHoverLink = navLastPointerType === "mouse" ? link : null;
  setActiveNavLink(link);
  syncNavLens();

  navPinTimer = window.setTimeout(() => {
    if (navPinnedLink !== link) return;
    navPinnedLink = null;
    navPinTimer = null;
    // iPad 点按后 :hover 会残留，不能用它判断指针是否还停在菜单上。
    if (navLastPointerType !== "mouse" || !navElement.matches(":hover")) {
      navHoverLink = null;
    }
    syncNavLens();
  }, 2000);
}

function setupNavLens() {
  if (!navElement || !navLensElement) return;

  // 先把每个菜单项的位置和宽度量一遍并缓存，后面滚动时就不用再读布局。
  measureNavLinks();

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
    }, 500);
  };

  navElement.querySelectorAll("a").forEach((link) => {
    link.addEventListener("pointerenter", (event) => {
      navLastPointerType = event.pointerType;
      // 触屏也会触发 pointerenter，但它不代表“悬停”，交给 pointerdown 处理。
      if (event.pointerType !== "mouse" || navTracking) return;
      if (navPinnedLink && navPinnedLink !== link) clearNavPin();
      navHoverLink = link;
      syncNavLens();
    });
  });

  navElement.addEventListener("pointerdown", (event) => {
    // 新的一次按下意味着上一次拖动已经结束，不再拦截新的 click。
    suppressNavClickUntil = 0;
    navLastPointerType = event.pointerType;

    if (event.pointerType === "mouse" || event.button !== 0) return;

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
    // 按下先快速贴到这一项；如果接着横向拖动，会切换到 drag 阶段。
    beginNavLensGesture(link);
  });

  // 监听 document 而不是 nav，手指滑出导航边缘时药丸也能继续跟手。
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!touchState || event.pointerId !== touchState.pointerId || event.pointerType === "mouse") {
        return;
      }

      const dx = event.clientX - touchState.startX;
      const dy = event.clientY - touchState.startY;

      // 只把明确的横向拖动当成“在菜单里滑”，纵向仍然是正常滚动页面。
      if (!touchState.moved) {
        if (Math.abs(dx) < 4 || Math.abs(dx) <= Math.abs(dy)) return;
        touchState.moved = true;
        navTracking = true;
        navLensMotion.phase = "drag";
        navLensMotion.clientX = event.clientX;
        // 导航已固定在屏幕上；这里更新一次，避免阅读器开关等布局变化留下旧值。
        navLensMotion.navRect = navElement.getBoundingClientRect();
        // 真正开始横向拖动：药丸明显放大；松手时由 settleNavLensTo 立刻收回。
        navLensElement.classList.remove("is-pressed");
        navLensElement.classList.add("is-dragging");
        startNavLensLoop();
        return;
      }

      // 这里只记录坐标，弹簧和样式统一在下一帧处理，最多每帧写一次。
      if (!navLensMotion.phase) {
        // 极少见的情况：拖动中旋转屏幕 / 改变窗口尺寸会把弹簧收掉，
        // 下一次移动时重新进入 drag 阶段，手势不会因此中断。
        navLensMotion.phase = "drag";
        navLensMotion.navRect = navElement.getBoundingClientRect();
        navLensMotion.link = navHoverLink || touchState.link;
        navLensElement.classList.remove("is-pressed");
        navLensElement.classList.add("is-dragging");
      }
      navLensMotion.clientX = event.clientX;
      startNavLensLoop();
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

      // 以松手位置为准再算一次最近项，避免最后一帧还没跑到就抬手。
      const releaseTarget = navLensDragTarget(
        event.clientX,
        navElement.getBoundingClientRect()
      );
      const selectedLink = releaseTarget?.link || navHoverLink || state.link;

      if (state.moved) {
        // 拖动结束后手动跳到选中的栏目，并吞掉随后浏览器可能补发的那次 click。
        suppressNavClickUntil = performance.now() + 650;
        // 药丸从当前位置弹到选中项，同时把 active 状态钉住，滚动与落位一起发生。
        settleNavLensTo(selectedLink);
        pinNavLens(selectedLink);
        navigateNavLink(selectedLink);
      } else {
        settleNavLensTo(state.link);
      }

      scheduleTouchReset();
      return;
    }

    // 普通点按：click 负责跳转，药丸只用一小段回弹落回被点的项。
    settleNavLensTo(state.link);
    scheduleTouchReset();
  };

  const cancelTouch = (event) => {
    if (!touchState || event.pointerId !== touchState.pointerId) return;

    touchState = null;
    navTracking = false;
    navHoverLink = null;
    cancelNavLensGesture();
    scheduleTouchReset();
  };

  // 切后台、失焦时 pointerup 可能不会到达，主动收尾，避免药丸卡在拖动态。
  const abortTouch = () => {
    if (!touchState) return;
    touchState = null;
    navTracking = false;
    navHoverLink = null;
    cancelNavLensGesture();
  };

  document.addEventListener("pointerup", endTouch, { passive: true });
  document.addEventListener("pointercancel", cancelTouch, { passive: true });
  window.addEventListener("blur", abortTouch);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) abortTouch();
  });

  // 拖动结束后浏览器偶尔还会补发一次 click，短暂拦截，避免重复跳转。
  navElement.addEventListener(
    "click",
    (event) => {
      if (performance.now() >= suppressNavClickUntil) return;
      // 键盘 / 辅助技术触发的 click detail 为 0，不应该被当成拖动的余波。
      if (event.detail === 0) return;
      const link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // 普通点击 / 键盘回车：药丸先钉住选中项，再统一交给 navigateNavLink 滚动。
  navElement.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link || !navElement.contains(link)) return;

    // 组合键点击保留浏览器原生行为（新标签页打开等）。
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    pinNavLens(link);
    navigateNavLink(link);
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
    document.fonts.ready.then(() => {
      measureNavLinks();
      syncNavLens(true);
    }).catch(() => {});
  }
}

/*
  根据当前滚动位置高亮顶部导航。
  判断逻辑：哪个 section 的顶部已经进入视口上方 42% 以内，就认为当前在这个栏目。

  性能注意：这段代码在滚动过程中会频繁执行，所以
  - section 节点只查一次并缓存，不在回调里反复 querySelector；
  - 文档高度用 ResizeObserver 维护，不再每帧读 scrollHeight；
  - 先读完所有几何信息，再统一改 class，避免 read → write → read 触发强制同步布局。
*/
const navSections = [];
let documentHeight = 0;

function cacheNavSections() {
  navSections.length = 0;
  for (const link of navLinks) {
    const href = link.getAttribute("href");
    const section = href ? document.querySelector(href) : null;
    if (section) navSections.push({ link, section });
  }
}

if (typeof ResizeObserver === "function") {
  // 内容渲染、图片加载都会改变页面高度，这里保持缓存是最新的。
  new ResizeObserver(() => {
    documentHeight = document.documentElement.scrollHeight;
  }).observe(document.documentElement);
}

function updateActiveNav() {
  if (!navSections.length) cacheNavSections();
  if (!navSections.length) return;

  // 读阶段：一次性取完所有需要的几何信息
  const scrollY = window.scrollY;
  const viewportHeight = window.innerHeight;
  const pageHeight = documentHeight || document.documentElement.scrollHeight;
  const atPageBottom = scrollY + viewportHeight >= pageHeight - 4;

  let actualCurrent = null;
  if (atPageBottom) {
    actualCurrent = navSections[navSections.length - 1].link;
  } else {
    for (let i = navSections.length - 1; i >= 0; i -= 1) {
      if (navSections[i].section.getBoundingClientRect().top < viewportHeight * 0.42) {
        actualCurrent = navSections[i].link;
        break;
      }
    }
  }

  // 写阶段
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

// 滚动事件本身可能是每帧多次触发，这里合并到下一帧统一处理。
let scrollFrameId = 0;

function handlePageScroll() {
  if (scrollFrameId) return;
  scrollFrameId = window.requestAnimationFrame(() => {
    scrollFrameId = 0;
    updateActiveNav();
    updateHeaderVisibility();
  });
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
  const reader = readerSection;
  const bar = readerBarElement?.querySelector(".reader-progress span");
  if (!reader || !bar) return;

  const max = reader.scrollHeight - reader.clientHeight;
  const progress = max > 0 ? Math.min(1, Math.max(0, reader.scrollTop / max)) : 0;
  bar.style.transform = `scaleX(${progress})`;
}

/*
  阅读层自检：正常情况下 1.2 秒后内容应该完全可见。
  如果动画/合成层在极少数情况下卡住，这里会先强制绘制，仍失败就重新走一次路由，
  避免用户一直盯着一张空的阅读纸。
*/
function readerDisplayBroken(reader) {
  const panel = reader.querySelector(".reader-panel");
  const body = reader.querySelector(".reader-body");
  if (!panel || !body) return true;

  const panelStyle = getComputedStyle(panel);
  const panelOpacity = Number.parseFloat(panelStyle.opacity);
  const readerOpacity = Number.parseFloat(getComputedStyle(reader).opacity);
  const bodyRect = body.getBoundingClientRect();
  const hasContent =
    body.innerText.trim().length > 0 ||
    Boolean(body.querySelector("img, figure, pre, ul, ol, table"));

  return (
    panelOpacity < 0.5 ||
    readerOpacity < 0.5 ||
    panelStyle.visibility === "hidden" ||
    !hasContent ||
    Boolean(document.querySelector(".reader-morph-ghost")) ||
    bodyRect.width < 80 ||
    bodyRect.height < 20
  );
}

function forceReaderPainted(reader) {
  const panel = reader.querySelector(".reader-panel");
  const bar = readerBarElement;
  reader.style.opacity = "1";
  reader.style.transform = "none";
  if (panel) {
    panel.style.opacity = "1";
    panel.style.transform = "none";
    panel.style.visibility = "";
  }
  if (bar) {
    bar.style.opacity = "1";
    bar.style.visibility = "";
  }

  // 同一帧内隐藏再恢复，丢弃可能卡住的合成层并强制一次布局/绘制。
  const previousDisplay = reader.style.display;
  reader.style.display = "none";
  void reader.offsetWidth;
  reader.style.display = previousDisplay;

  requestAnimationFrame(() => {
    reader.style.opacity = "";
    reader.style.transform = "";
    if (panel) {
      panel.style.opacity = "";
      panel.style.transform = "";
    }
    if (bar) bar.style.opacity = "";
  });
}

function refreshReaderPanel(reader) {
  const panel = reader.querySelector(".reader-panel");
  if (!panel) return;
  // 动画结束后用同一帧的零位移 transform 重新栅格化正文层，
  // 避免个别 Chromium 版本把已经结束的透明/位移层留在“空白”状态。
  const previousTransform = panel.style.transform;
  panel.style.transform = "translate3d(0, 0, 0)";
  void panel.offsetWidth;
  requestAnimationFrame(() => {
    panel.style.transform = previousTransform;
  });
}

function checkReaderDisplay(reader) {
  if (!isReaderOpen() || isClosingReader) return;
  if (!readerDisplayBroken(reader)) {
    refreshReaderPanel(reader);
    return;
  }

  const info = {
    time: new Date().toISOString(),
    hash: window.location.hash,
    title: reader.querySelector(".reader-title")?.textContent || "",
    panelOpacity: getComputedStyle(reader.querySelector(".reader-panel")).opacity,
    readerOpacity: getComputedStyle(reader).opacity,
    bodyLength: reader.querySelector(".reader-body")?.innerText.trim().length || 0,
    ghost: Boolean(document.querySelector(".reader-morph-ghost")),
    scrollTop: reader.scrollTop,
    rect: reader.getBoundingClientRect().toJSON?.() || {},
    viewport: { width: window.innerWidth, height: window.innerHeight },
    userAgent: navigator.userAgent,
  };
  console.warn("阅读层显示异常，正在自动恢复", info);
  try {
    sessionStorage.setItem("reader-display-issue", JSON.stringify(info));
  } catch (error) {
    // sessionStorage 不可用时忽略，不影响恢复。
  }

  cancelReaderMotion();
  forceReaderPainted(reader);

  // 再给浏览器一帧时间；如果仍然不可见，就关掉重开当前详情。
  requestAnimationFrame(() => {
    if (!isReaderOpen() || isClosingReader) return;
    if (!readerDisplayBroken(reader)) return;
    if (!window.location.hash.includes("/")) return;
    // 同一轮里只自动重开一次，避免真的遇到浏览器级渲染故障时无限循环。
    if (Date.now() - lastReaderRecoveryAt < 5000) return;
    lastReaderRecoveryAt = Date.now();
    hideReader({ restoreFocus: false });
    handleRoute();
  });
}

function scheduleReaderDisplayCheck(reader) {
  window.clearTimeout(readerSettleTimer);
  readerSettleTimer = window.setTimeout(() => {
    readerSettleTimer = 0;
    checkReaderDisplay(reader);
  }, 1200);
}

function setReader({ type, title, bodyHtml, backHref, meta = "" }) {
  closeImageLightbox({ immediate: true });
  const reader = document.querySelector("#reader");
  const wasOpen = isReaderOpen();
  // 先量卡片位置：随后锁定页面滚动可能让布局有极小的横向变化。
  // 点击进入时用被点的卡片；前进/后退或刷新恢复详情时，按 hash 找回对应卡片。
  const sourceLink =
    (currentOpenSource?.link?.isConnected ? currentOpenSource.link : null) ||
    findCurrentDetailLink(window.location.hash);
  const sourceRect = sourceLink ? sourceLink.getBoundingClientRect() : null;

  reader.querySelector(".reader-type").textContent = type;
  reader.querySelector(".reader-title").textContent = title;
  const metaElement = reader.querySelector(".reader-meta");
  if (metaElement) metaElement.textContent = meta;
  // 最后一道兜底：任何情况下都不把阅读区写成纯空白。
  const safeBodyHtml = bodyHtml?.trim() ? bodyHtml : "<p>这篇内容暂时没有正文。</p>";
  if (!bodyHtml?.trim()) console.warn("阅读层正文为空", { type, title });
  reader.querySelector(".reader-body").innerHTML = safeBodyHtml;
  readerBarElement?.querySelector(".reader-back")?.setAttribute("href", backHref);
  document.body.classList.add("is-reader-open");
  document.body.classList.remove("is-reader-closing");
  document.body.classList.remove("is-header-hidden");
  syncNavDockInert();
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

  if (!wasOpen) animateReaderTransition(reader, true, { sourceLink, sourceRect });
  scheduleReaderDisplayCheck(reader);
}

function hideReader({ restoreFocus = true } = {}) {
  window.clearTimeout(readerSettleTimer);
  readerSettleTimer = 0;
  const reader = document.querySelector("#reader");
  const returnLink = currentOpenSource?.href ? findCurrentDetailLink(currentOpenSource.href) : null;

  cancelReaderMotion();
  reader.classList.remove("is-open");
  reader.setAttribute("aria-hidden", "true");
  reader.inert = true;
  closeImageLightbox({ immediate: true });
  document.body.classList.remove("is-reader-open");
  document.body.classList.remove("is-reader-closing");
  document.body.classList.remove("is-header-hidden");
  cancelReaderBarMotion();
  syncNavDockInert();
  if (pageShell) pageShell.inert = false;
  document.title = BASE_TITLE;

  if (restoreFocus && returnLink) {
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
  syncNavDockInert();
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
    syncNavDockInert();

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

async function openMarkdownDetail(kind, file, isCurrent = () => true) {
  const isNote = kind === "note";
  const isUpdate = kind === "update";
  const entries = isNote ? notesData : isUpdate ? updatesData : reposData;
  const entry = entries.find((item) => item.file === file);
  if (!entry) return false;

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

  // 读取或解析失败时也保证详情页有一行可见文字，而不是整块空白。
  const bodyHtml = body.trim() ? body : "<p>这篇内容暂时没有正文。</p>";
  if (!body.trim()) console.warn(`详情内容为空：${kind}/${file}`, { markdownLength: markdown.length });
  if (!isCurrent()) return false;

  setReader({
    type: isNote ? "Note" : isUpdate ? "Update" : "Repository",
    title: entry.title,
    meta,
    // 详情页顶部已经有 reader-title，这里去掉 Markdown 第一行 H1，避免标题重复显示。
    bodyHtml,
    backHref: isNote ? "#notes" : isUpdate ? "#updates" : "#repos",
  });
  return true;
}

async function openGalleryDetail(file, isCurrent = () => true) {
  const entry = galleryData.find((item) => item.file === file);
  if (!entry) return false;

  const markdown = stripFrontmatter(await readTextSafe(`./content/gallery/${file}`));
  const photoCount = (markdown.match(/^!\[/gm) || []).length;
  const body = markdown
    ? markdownToHtml(stripFirstHeading(markdown), { imageBasePath: "./content/gallery/" })
    : "<p>相册内容暂时无法读取，请刷新页面或重新运行 start-blog.command。</p>";

  const bodyHtml = body.trim() ? body : "<p>这本相册暂时没有正文。</p>";
  if (!body.trim()) console.warn(`相册内容为空：${file}`, { markdownLength: markdown.length });
  if (!isCurrent()) return false;

  setReader({
    type: "Gallery",
    title: entry.title,
    meta: [entry.date, entry.place, photoCount ? `${photoCount} 张照片` : ""].filter(Boolean).join(" · "),
    bodyHtml,
    backHref: "#gallery",
  });
  return true;
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
  // 读取期间地址可能已经变了（快速返回、前进后退或连点两张卡片），
  // 只允许“仍然指向当前 hash”的那一次打开真正写入阅读层。
  const isCurrent = () => window.location.hash === fullHash && !isClosingReader;

  let opened = false;
  if (kind === "note" || kind === "repo" || kind === "update") {
    opened = await openMarkdownDetail(kind, file, isCurrent);
  } else if (kind === "gallery") {
    opened = await openGalleryDetail(file, isCurrent);
  }

  if (opened && isCurrent()) lastDetailHash = fullHash;
}

/*
  点击卡片时记住卡片在页面里的位置和当时的滚动位置；
  返回列表时会用它恢复到原来的阅读位置。
*/
function recordOpenSource(link) {
  const href = link.getAttribute("href");
  currentOpenSource = {
    href,
    link,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

// 进入和退出使用同一张真实阅读面板，方向相反，避免正文突然变成空白色块。
const READER_REST = { transform: "translateY(0) scale(1)", opacity: 1 };
const READER_DISMISSED = { transform: "translateY(32px) scale(0.975)", opacity: 0 };
const READER_CONTENT_REST = { transform: "translateY(0)", opacity: 1 };
const READER_CONTENT_DISMISSED = { transform: "translateY(12px)", opacity: 0 };

// 卡片 → 阅读面板的形变只做 transform / opacity，交给合成器完成，避免逐帧重排。
const MORPH_OPEN_DURATION = 480;
const MORPH_CLOSE_DURATION = 400;
const MORPH_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";

/*
  取一个元素在视口里的有效矩形。完全在屏幕外或尺寸太小时返回 null，
  这样从浏览器历史直接打开详情时，会走原来的轻量淡入淡出。
*/
function isRectVisible(rect) {
  return Boolean(
    rect &&
    rect.width >= 32 &&
    rect.height >= 24 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

function getVisibleRect(element) {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  return isRectVisible(rect) ? rect : null;
}

// 用一条 transform 把 fromRect 精确映射到 toRect（元素默认以中心为原点缩放）。
function morphTransform(fromRect, toRect) {
  const fromX = fromRect.left + fromRect.width / 2;
  const fromY = fromRect.top + fromRect.height / 2;
  const toX = toRect.left + toRect.width / 2;
  const toY = toRect.top + toRect.height / 2;
  const scaleX = toRect.width / fromRect.width;
  const scaleY = toRect.height / fromRect.height;
  return `translate3d(${(toX - fromX).toFixed(2)}px, ${(toY - fromY).toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
}

/*
  打开详情时克隆被点击的卡片，叠在阅读层上方做“卡片长大成页面”的动画。
  克隆体固定定位、尺寸不变，只改变 transform，所以浏览器不需要重新布局整页。
*/
function createReaderMorphGhost(link, rect) {
  if (!link) return null;
  const linkStyle = getComputedStyle(link);
  const hoveredSurface = link.querySelector(".note-card, .repo-card, .update-card, figure");
  const hoveredTransform = hoveredSurface ? getComputedStyle(hoveredSurface).transform : "none";
  const ghost = document.createElement("div");
  const clone = link.cloneNode(true);
  const isGallery = link.classList.contains("gallery-item");

  ghost.className = "reader-morph-ghost";
  if (isGallery && link.matches(".gallery-item:nth-child(3n)")) ghost.classList.add("is-wide");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });

  clone.classList.add("reader-morph-ghost__card");
  clone.removeAttribute("id");
  clone.removeAttribute("href");
  clone.removeAttribute("data-reveal");
  clone.setAttribute("tabindex", "-1");
  clone.style.display = linkStyle.display;
  // 点击时卡片正处于 hover 的轻微上浮状态，把这个位移也带进影子里。
  const cloneSurface = clone.querySelector(".note-card, .repo-card, .update-card, figure");
  if (cloneSurface && hoveredTransform !== "none") cloneSurface.style.transform = hoveredTransform;
  clone.querySelectorAll("[data-reveal]").forEach((node) => {
    node.removeAttribute("data-reveal");
    node.classList.remove("is-visible");
  });
  clone.querySelectorAll("img").forEach((image) => {
    // 使用已经加载好的缩略图，形变过程中不再触发新的网络请求。
    if (image.currentSrc) image.src = image.currentSrc;
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.loading = "eager";
    image.decoding = "sync";
    image.draggable = false;
  });

  // 相册卡片的大号编号来自 CSS counter；离开 .gallery-grid 后需要补回序号。
  if (isGallery) {
    const index = [...link.parentElement.children].indexOf(link);
    ghost.style.counterReset = `album ${Math.max(0, index)}`;
  }

  ghost.append(clone);
  document.body.append(ghost);
  return ghost;
}

function removeReaderMorphGhost(ghost) {
  if (ghost?.isConnected) ghost.remove();
}

function cancelReaderMotion() {
  if (!readerMotion) return;
  const motion = readerMotion;
  readerMotion = null;
  if (motion.timer) window.clearTimeout(motion.timer);
  if (motion.revealTimer) window.clearTimeout(motion.revealTimer);
  motion.hiddenContent.forEach((element) => {
    element.style.visibility = "";
  });
  motion.animations.forEach((animation) => animation.cancel());
  removeReaderMorphGhost(motion.ghost);
  motion.sourceLink?.classList.remove("is-morph-source");
}

async function animateReaderTransition(reader, opening, { sourceLink = null, sourceRect = null } = {}) {
  const scrim = document.querySelector(".reader-scrim");
  const panel = reader.querySelector(".reader-panel");
  const bar = readerBarElement;
  const dockedReader = isNavDocked();
  // 在取消旧动画前取当前画面，快速按 Esc 时也能从当前位置平滑退出。
  const current = getComputedStyle(reader);
  const start = opening ? READER_DISMISSED : {
    transform: current.transform,
    opacity: current.opacity,
  };
  const scrimOpacity = opening ? 0 : (scrim ? getComputedStyle(scrim).opacity : 1);
  const barStyle = bar ? getComputedStyle(bar) : null;
  const panelStyle = panel ? getComputedStyle(panel) : null;
  const panelStart = opening ? READER_CONTENT_DISMISSED : panelStyle ? {
    transform: panelStyle.transform,
    opacity: panelStyle.opacity,
  } : READER_CONTENT_REST;
  cancelReaderMotion();
  if (prefersReducedMotion()) return;

  // 移动端 / iPad：详情导航条从底部主导航的位置长出来。
  if (opening) animateReaderBarIn();

  const motion = {
    animations: [],
    ghost: null,
    sourceLink: null,
    timer: null,
    revealTimer: 0,
    hiddenContent: [],
  };
  readerMotion = motion;

  // 打开前卡片已经被量好尺寸；但如果是从详情 URL 直接打开、卡片还在屏幕外，
  // 就不能拿它当形变起点，否则会从屏幕外长出一张纸，正文也迟迟不出现。
  const cardRect = opening
    ? (isRectVisible(sourceRect) ? sourceRect : null)
    : getVisibleRect(sourceLink);
  let ghost = null;
  if (opening && cardRect) {
    try {
      ghost = createReaderMorphGhost(sourceLink, cardRect);
    } catch (error) {
      // 克隆失败时退回普通淡入，不影响阅读本身。
      console.warn("卡片形变效果已跳过", error);
    }
  }
  const morphing = opening ? Boolean(ghost) : Boolean(cardRect);

  if (ghost) {
    motion.ghost = ghost;
    motion.sourceLink = sourceLink;
    sourceLink.classList.add("is-morph-source");
  }

  try {
    if (opening && ghost) {
      const readerRect = reader.getBoundingClientRect();
      // 真正的阅读纸从卡片矩形长到全屏矩形。
      const readerFrom = morphTransform(readerRect, cardRect);
      motion.animations.push(ghost.animate([
        { transform: "translate3d(0, 0, 0) scale(1, 1)", opacity: 1, offset: 0 },
        { transform: "translate3d(0, 0, 0) scale(1.03, 1.03)", opacity: 1, offset: 0.4 },
        { transform: "translate3d(0, 0, 0) scale(1.05, 1.05)", opacity: 0, offset: 1 },
      ], {
        duration: 230,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "both",
      }));

      motion.animations.push(reader.animate([
        { transform: readerFrom },
        { transform: "translate3d(0, 0, 0) scale(1, 1)" },
      ], {
        duration: MORPH_OPEN_DURATION,
        easing: MORPH_EASING,
        fill: "both",
      }));

      /*
        正文不再用透明度动画隐藏，而是先用 visibility 藏起来，纸面基本铺开后再显示。
        这样即使某个 Chromium 版本把“已经结束的透明层”留在空白状态，也只会影响
        动画本身，不会把正文永久留在 opacity: 0。
      */
      if (bar && !dockedReader) {
        bar.style.opacity = "";
        bar.style.visibility = "hidden";
        motion.hiddenContent.push(bar);
      }
      if (panel) {
        panel.style.opacity = "";
        panel.style.transform = "";
        panel.style.visibility = "hidden";
        motion.hiddenContent.push(panel);
        motion.animations.push(panel.animate([
          { transform: "translate3d(0, 12px, 0)" },
          { transform: "translate3d(0, 0, 0)" },
        ], {
          duration: 220,
          delay: Math.round(MORPH_OPEN_DURATION * 0.88),
          easing: MORPH_EASING,
          fill: "both",
        }));
      }
      motion.revealTimer = window.setTimeout(() => {
        motion.revealTimer = 0;
        motion.hiddenContent.forEach((element) => {
          element.style.visibility = "";
        });
      }, Math.round(MORPH_OPEN_DURATION * 0.88));

      if (scrim) {
        motion.animations.push(scrim.animate([
          { opacity: 0 },
          { opacity: 1 },
        ], { duration: 440, easing: "ease-out", fill: "both" }));
      }
    } else if (!opening && morphing) {
      // 退出时先让正文退场，再把整张纸缩回卡片的位置和大小。
      const readerRect = reader.getBoundingClientRect();
      const target = morphTransform(readerRect, cardRect);
      const startTransform = current.transform === "none" ? "translate3d(0, 0, 0) scale(1)" : current.transform;
      const startOpacity = Number.parseFloat(current.opacity);
      const startOpacityValue = Number.isFinite(startOpacity) ? startOpacity : 1;
      const barStartOpacity = barStyle ? Number.parseFloat(barStyle.opacity) : 1;
      motion.animations.push(reader.animate([
        {
          transform: startTransform,
          opacity: startOpacityValue,
          offset: 0,
        },
        { transform: target, opacity: startOpacityValue, offset: 0.8 },
        { transform: target, opacity: 0, offset: 1 },
      ], {
        duration: MORPH_CLOSE_DURATION,
        delay: 70,
        easing: MORPH_EASING,
        fill: "both",
      }));
      if (bar && !dockedReader) {
        motion.animations.push(bar.animate([
          { opacity: Number.isFinite(barStartOpacity) ? barStartOpacity : 1 },
          { opacity: 0 },
        ], { duration: 120, easing: "ease-in", fill: "both" }));
      }
      if (panel) {
        motion.animations.push(panel.animate([
          { transform: panelStart.transform, opacity: Number.parseFloat(panelStart.opacity) || 1 },
          { transform: "translateY(8px)", opacity: 0 },
        ], { duration: 140, easing: "ease-in", fill: "both" }));
      }
      if (scrim) {
        motion.animations.push(scrim.animate([
          { opacity: Number.parseFloat(scrimOpacity) || 1 },
          { opacity: 0 },
        ], { duration: 420, delay: 20, easing: "ease-in", fill: "both" }));
      }
    } else if (opening) {
      /*
        没有来源卡片时（例如直接打开/刷新详情 URL），正文从第一帧就保持可见，
        只让阅读纸做一次轻微上浮。这样这里也不可能因为透明度动画卡住而出现空白。
      */
      reader.style.opacity = "";
      reader.style.transform = "";
      if (panel) {
        panel.style.opacity = "";
        panel.style.transform = "";
        panel.style.visibility = "";
      }
      if (bar && !dockedReader) bar.style.visibility = "";

      motion.animations.push(reader.animate([
        { transform: "translate3d(0, 26px, 0) scale(0.986)" },
        { transform: "translate3d(0, 0, 0) scale(1)" },
      ], {
        duration: 380,
        easing: MORPH_EASING,
        fill: "both",
      }));
      if (panel) {
        motion.animations.push(panel.animate([
          { transform: "translate3d(0, 10px, 0)" },
          { transform: "translate3d(0, 0, 0)" },
        ], {
          duration: 300,
          delay: 60,
          easing: MORPH_EASING,
          fill: "both",
        }));
      }
      if (scrim) {
        motion.animations.push(scrim.animate([
          { opacity: 0 },
          { opacity: 1 },
        ], { duration: 360, easing: "ease-out", fill: "both" }));
      }
    } else {
      // 没有来源卡片时的退出：正文先收，整张纸再离开。
      const options = {
        duration: 360,
        delay: 40,
        easing: "cubic-bezier(0.4, 0, 1, 1)",
        fill: "both",
      };
      motion.animations.push(reader.animate([start, READER_DISMISSED], options));
      if (panel) {
        motion.animations.push(panel.animate([
          panelStart,
          READER_CONTENT_DISMISSED,
        ], { ...options, duration: 320 }));
      }
      if (scrim) {
        motion.animations.push(scrim.animate([
          { opacity: scrimOpacity },
          { opacity: 0 },
        ], { ...options, duration: 400 }));
      }
    }
    const animationsDone = Promise.all(
      motion.animations.map((animation) => animation.finished.catch(() => {}))
    );
    // 极少数情况下浏览器会暂停动画时间线（例如切到后台、系统休眠），
    // finished 可能迟迟不返回。兜底到点后直接进入最终状态，避免详情页一直空着。
    let watchdogFired = false;
    const watchdog = new Promise((resolve) => {
      motion.timer = window.setTimeout(() => {
        watchdogFired = true;
        resolve();
      }, 1000);
    });
    await Promise.race([animationsDone, watchdog]);
    if (watchdogFired) console.warn("阅读层动画超时，已直接显示最终状态");
  } finally {
    if (motion.timer) {
      window.clearTimeout(motion.timer);
      motion.timer = null;
    }
    // 退出动画保留最后一帧，等 hideReader 一次性隐藏并清理，避免闪回。
    if (opening && readerMotion === motion) {
      cancelReaderMotion();
      requestAnimationFrame(() => {
        if (isReaderOpen() && !isClosingReader) refreshReaderPanel(reader);
      });
    }
  }
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

/* 阅读面板与遮罩同步退场，结束后再恢复列表和焦点。 */
async function animateReaderClose(backHref, detailHash = window.location.hash, { updateHash = true } = {}) {
  if (isClosingReader) return;
  const reader = document.querySelector("#reader");
  const targetLink = findCurrentDetailLink(detailHash);
  isClosingReader = true;

  try {
    if (reader?.classList.contains("is-open")) {
      // 返回时先让详情导航条缩回底部主导航，同时把底部主导航露出来。
      if (isNavDocked()) {
        document.body.classList.add("is-reader-closing");
        animateReaderBarOut();
      }
      await animateReaderTransition(reader, false, { sourceLink: targetLink });
    }
  } finally {
    hideReader({ restoreFocus: false });
    // 关闭动画期间如果地址被切到了另一篇详情（前进/后退或快速操作），
    // 不要把它改回列表页，等清理完再按新地址打开。
    const pendingHash = window.location.hash;
    const pendingDetail = pendingHash.includes("/") && pendingHash !== detailHash;

    if (!pendingDetail) {
      if (targetLink?.isConnected) restoreListPositionForReturn(targetLink, detailHash);
      if (updateHash) setHashWithoutJump(backHref);
    }

    currentOpenSource = null;
    lastDetailHash = "";
    isClosingReader = false;

    if (pendingDetail) {
      queueMicrotask(handleRoute);
    } else if (targetLink?.isConnected) {
      targetLink.focus({ preventScroll: true });
    }
  }
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
  // 宽度变了，菜单项的缓存尺寸要重新量；跨过断点时还要把导航挪回页头 / 移到底部。
  syncNavPlacement();
  measureNavLinks();
  syncNavLens(true);
});
narrowNavQuery.addEventListener("change", syncNavPlacement);
touchNavQuery.addEventListener("change", syncNavPlacement);
wideTouchQuery.addEventListener("change", syncNavPlacement);
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

/*
  浏览器里偶尔会遇到阅读层“看起来是空的”的情况，但终端只能看到静态服务器日志。
  带 ?debug=1 打开页面时，右下角会显示一个实时状态面板，方便截图定位；
  正常访问不会创建它，也没有额外开销。
*/
function setupReaderDebugHud() {
  if (!new URLSearchParams(window.location.search).has("debug")) return;

  const hud = document.createElement("pre");
  hud.id = "reader-debug-hud";
  Object.assign(hud.style, {
    position: "fixed",
    left: "8px",
    bottom: "8px",
    zIndex: "10000",
    maxWidth: "min(600px, 92vw)",
    maxHeight: "42vh",
    margin: "0",
    padding: "8px 10px",
    overflow: "auto",
    borderRadius: "8px",
    background: "rgba(0, 0, 0, 0.84)",
    color: "#fff",
    font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "pre-wrap",
    pointerEvents: "none",
  });
  document.body.append(hud);

  const warnings = [];
  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    warnings.push(args.map((value) => String(value)).join(" "));
    originalWarn(...args);
  };
  window.addEventListener("error", (event) => warnings.push(`error: ${event.message}`));
  window.addEventListener("unhandledrejection", (event) => warnings.push(`rejection: ${event.reason}`));

  const render = () => {
    const reader = document.querySelector("#reader");
    const panel = reader?.querySelector(".reader-panel");
    const body = reader?.querySelector(".reader-body");
    const title = reader?.querySelector(".reader-title");
    const bar = readerBarElement;
    const rect = reader?.getBoundingClientRect();

    hud.textContent = [
      `hash: ${window.location.hash || "(none)"}`,
      `reader: ${reader?.classList.contains("is-open") ? "open" : "closed"}  motion: ${readerMotion ? "yes" : "no"}  closing: ${isClosingReader}`,
      `title: ${title?.textContent?.trim() || ""}`,
      `body: ${body?.innerText.trim().length || 0} chars`,
      `opacity reader/panel/bar: ${reader ? getComputedStyle(reader).opacity : "-"} / ${panel ? getComputedStyle(panel).opacity : "-"} / ${bar ? getComputedStyle(bar).opacity : "-"}`,
      `transform: ${reader ? getComputedStyle(reader).transform : "-"}`,
      `rect: ${rect ? `${Math.round(rect.width)}×${Math.round(rect.height)} @ ${Math.round(rect.left)},${Math.round(rect.top)}` : "-"}`,
      `broken: ${reader ? readerDisplayBroken(reader) : "-"}`,
      `ghost: ${document.querySelectorAll(".reader-morph-ghost").length}`,
      `warnings: ${warnings.length ? `\n${warnings.slice(-5).join("\n")}` : "(none)"}`,
    ].join("\n");
  };

  render();
  window.setInterval(render, 400);
}

document.querySelector("#reader")?.addEventListener("scroll", updateReaderProgress, { passive: true });

/*
  初始化顺序：
  1. 确认主题开关状态。
  2. 给 HTML 里已有元素绑定滚动入场。
  3. 更新一次导航状态。
  4. 读取内容文件并渲染笔记、仓库、相册、更新。
*/
setupReaderDebugHud();
setupThemeToggle();
setupTermTip();
syncNavPlacement();
setupNavLens();
prepareReveal();
updateActiveNav();
renderContent();
