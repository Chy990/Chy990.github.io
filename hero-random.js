/* 首屏随机展示 3–5 项：一篇笔记和 2–4 张相册照片。 */
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

  // 先从不同相册各取一张，再从剩余照片补足，避免重复。
  const albums = shuffle(gallery.filter((album) => photosOf(album).length > 0));
  const photoCount = 2 + Math.floor(Math.random() * 3);
  const firstPhotos = albums.map((album) => {
    const photo = pickOne(photosOf(album));
    return { ...photo, album };
  });
  const usedSources = new Set(firstPhotos.map((photo) => photo.src));
  const remainingPhotos = shuffle(albums.flatMap((album) => photosOf(album)
    .filter((photo) => !usedSources.has(photo.src))
    .map((photo) => ({ ...photo, album }))));
  const selections = [...firstPhotos, ...remainingPhotos].slice(0, photoCount);

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

  selections.forEach((photo, index) => preloadImage(photo.src, index === 0 ? "high" : "auto"));

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

    // 记住最近经过的图版，鼠标离开后仍保留它的层级。
    if (!visual.dataset.frontTracking) {
      visual.dataset.frontTracking = "true";
      visual.addEventListener("pointerover", (event) => {
        if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
        const card = event.target.closest(".hero-plate, .journal-card");
        if (!card || !visual.contains(card) || card.contains(event.relatedTarget)) return;
        visual.querySelectorAll(".is-front").forEach((item) => item.classList.remove("is-front"));
        card.classList.add("is-front");
      });
    }

    const mainPlate =
      visual.querySelector('[data-hero-plate="main"]') || visual.querySelector(".hero-plate--main");
    const subPlate =
      visual.querySelector('[data-hero-plate="sub"]') || visual.querySelector(".hero-plate--sub");

    applyPhoto(mainPlate, selections[0], true);
    applyPhoto(subPlate, selections[1], false);

    visual.querySelectorAll("[data-hero-extra]").forEach((plate) => plate.remove());
    selections.slice(2).forEach((selection) => {
      const plate = document.createElement("div");
      plate.className = "hero-plate hero-plate--extra";
      plate.setAttribute("data-hero-extra", "");
      plate.innerHTML = '<figure class="hero-photo"><img alt="" decoding="async"><figcaption><span data-hero-place></span><span data-hero-date></span></figcaption></figure>';
      applyPhoto(plate, selection, false);
      visual.append(plate);
    });
    visual.dataset.heroCount = String(3 + Math.max(0, selections.length - 2));

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
