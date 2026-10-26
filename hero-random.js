/*
  hero-random.js — 首屏右侧三块内容的随机选择。

  原来这两张照片和手记卡是直接写在 index.html 里的固定内容。
  现在每次打开页面都会：
  1. 从相册（优先不同相册）里随机挑 2 张照片；
  2. 从笔记里随机挑 1 篇，把手记卡换成这篇笔记的标题；
  3. 在 <head> 里预加载选中的两张缩略图，避免首屏空等；
  4. 首屏 HTML 解析到之后，由 index.html 里的一小段脚本调用
     applyHeroRandom() 把内容填进去。

  这个文件在 <head> 里同步执行，只负责“选”和“预加载”；
  真正改 DOM 的 applyHeroRandom 要等首屏结构存在后再调用。
*/
(function () {
  const index = window.BLOG_CONTENT;
  if (!index) return;

  const gallery = Array.isArray(index.gallery) ? index.gallery : [];
  const notes = Array.isArray(index.notes) ? index.notes : [];

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function pickOne(list) {
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  function photosOf(album) {
    if (Array.isArray(album.photos) && album.photos.length) {
      return album.photos
        .filter((photo) => photo && photo.src)
        .map((photo) => ({ src: photo.src, alt: photo.alt || "" }));
    }
    return album.cover ? [{ src: album.cover, alt: album.title || "" }] : [];
  }

  /*
    优先从两个不同相册各取一张，这样首屏不会总是同一趟旅行；
    如果只有一个相册有照片，就从这个相册里随机取两张。
  */
  const albums = gallery.filter((album) => photosOf(album).length > 0);
  let selections = [];

  if (albums.length >= 2) {
    shuffle(albums)
      .slice(0, 2)
      .forEach((album) => {
        const photo = pickOne(photosOf(album));
        if (photo) selections.push({ src: photo.src, alt: photo.alt, album });
      });
  } else if (albums.length === 1) {
    const album = albums[0];
    selections = shuffle(photosOf(album))
      .slice(0, 2)
      .map((photo) => ({ src: photo.src, alt: photo.alt, album }));
  }

  selections = selections.slice(0, 2);

  const selectedNote = pickOne(notes);
  const hero = { photos: selections, note: selectedNote };
  window.__HERO_RANDOM = hero;

  function fullImageSrc(src) {
    if (/^(https?:|data:|\/|\.\/)/i.test(src)) return src;
    return `./content/gallery/${src}`;
  }

  // 和 script.js 里的 galleryThumbnailSrc 保持一致。
  function thumbnailSrc(src) {
    const full = fullImageSrc(src);
    if (!full.startsWith("./content/gallery/")) return full;
    if (full.startsWith("./content/gallery/_thumbs/")) return full;
    return full
      .replace("./content/gallery/", "./content/gallery/_thumbs/")
      .replace(/\.(jpe?g|png)$/i, ".jpg");
  }

  function dateLabel(value) {
    const date = String(value || "");
    const match = date.match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}.${match[2]}` : date;
  }

  // 在 <head> 里就把选中的缩略图排队下载，首屏不用等脚本跑到 body 末尾。
  function preloadImage(src, priority) {
    if (!src) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = thumbnailSrc(src);
    if (priority) link.setAttribute("fetchpriority", priority);
    document.head.append(link);
  }

  preloadImage(selections[0]?.src, "high");
  preloadImage(selections[1]?.src, "auto");

  function applyPhoto(plate, selection, isMain) {
    if (!plate || !selection) return;

    const image = plate.querySelector("img");
    if (!image) return;

    const album = selection.album;
    const place = album.place || album.title || "相册";

    image.src = thumbnailSrc(selection.src);
    image.setAttribute("data-fallback-src", fullImageSrc(selection.src));
    image.alt = selection.alt ? `${selection.alt} · ${place}` : place;

    if (isMain) {
      image.setAttribute("fetchpriority", "high");
    } else {
      image.removeAttribute("fetchpriority");
    }

    const placeLabel = plate.querySelector("[data-hero-place]");
    const dateLabelElement = plate.querySelector("[data-hero-date]");
    if (placeLabel) placeLabel.textContent = place;
    if (dateLabelElement) dateLabelElement.textContent = dateLabel(album.date);
  }

  /*
    首屏结构出现后由 index.html 调用。
    如果清单为空，静态兜底内容保持不动。
  */
  window.applyHeroRandom = function applyHeroRandom() {
    const visual = document.querySelector(".hero-visual");
    if (!visual) return;

    const mainPlate =
      visual.querySelector('[data-hero-plate="main"]') || visual.querySelector(".hero-plate--main");
    const subPlate =
      visual.querySelector('[data-hero-plate="sub"]') || visual.querySelector(".hero-plate--sub");

    applyPhoto(mainPlate, selections[0], true);
    applyPhoto(subPlate, selections[1], false);

    if (!selectedNote) return;

    const card = visual.querySelector(".journal-card");
    if (!card) return;

    const label = card.querySelector("[data-hero-note-label]");
    const date = card.querySelector("[data-hero-note-date]");
    const title = card.querySelector("[data-hero-note-title]");
    const foot = card.querySelector("[data-hero-note-foot]");

    if (label) label.textContent = "笔记摘录";
    if (date) date.textContent = dateLabel(selectedNote.date);
    if (title) title.textContent = `《${selectedNote.title || "未命名笔记"}》`;
    if (foot) foot.textContent = `${selectedNote.type || "笔记"} / Note`;
  };
})();
