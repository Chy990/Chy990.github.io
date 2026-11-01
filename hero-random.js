/* 首屏每次挑选九张相册照片和一篇笔记，立在一圈 3D 圆环上，可拖动、甩动和用左右键切换。 */
(function () {
  const index = window.BLOG_CONTENT || {};
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

  function photosOf(album) {
    if (Array.isArray(album.photos) && album.photos.length) {
      return album.photos.filter((photo) => photo && photo.src)
        .map((photo) => ({ src: photo.src, alt: photo.alt || "", album }));
    }
    return album.cover ? [{ src: album.cover, alt: album.title || "", album }] : [];
  }

  // 优先从不同相册选图，再从其余照片补足；卡片数量不随刷新改变。
  const albums = shuffle(gallery.filter((album) => photosOf(album).length));
  const firstPhotos = albums.map((album) => shuffle(photosOf(album))[0]);
  const usedSources = new Set(firstPhotos.map((photo) => photo.src));
  const remainingPhotos = shuffle(albums.flatMap(photosOf).filter((photo) => !usedSources.has(photo.src)));
  const selectedNote = shuffle(notes)[0];
  const selections = [...firstPhotos, ...remainingPhotos].slice(0, selectedNote ? 9 : 10);
  window.__HERO_RANDOM = { photos: selections, note: selectedNote };

  function fullImageSrc(src) {
    if (/^(https?:|data:|\/|\.\/)/i.test(src)) return src;
    return `./content/gallery/${src}`;
  }

  // 和 script.js 里的 galleryThumbnailSrc 保持一致。
  function thumbnailSrc(src) {
    const full = fullImageSrc(src);
    if (!full.startsWith("./content/gallery/") || full.startsWith("./content/gallery/_thumbs/")) return full;
    return full.replace("./content/gallery/", "./content/gallery/_thumbs/").replace(/\.(jpe?g|png)$/i, ".jpg");
  }

  function dateLabel(value) {
    const date = String(value || "");
    const match = date.match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}.${match[2]}` : date;
  }

  // 在首屏解析前开始下载选中的缩略图。
  selections.forEach((photo, index) => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = thumbnailSrc(photo.src);
    if (index === 0) link.setAttribute("fetchpriority", "high");
    document.head.append(link);
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function cardShell(label) {
    const card = el("div", "orbit-card");
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", label);
    return card;
  }

  function photoCard(selection, isFirst) {
    const album = selection.album;
    const place = album.place || album.title || "相册";
    const date = dateLabel(album.date);
    const card = cardShell([selection.alt, place, date].filter(Boolean).join(" · "));
    const face = el("div", "orbit-face orbit-face--front orbit-face--photo");
    const image = document.createElement("img");
    image.src = thumbnailSrc(selection.src);
    image.dataset.fallbackSrc = fullImageSrc(selection.src);
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    if (isFirst) image.setAttribute("fetchpriority", "high");
    const caption = el("div", "orbit-caption");
    caption.append(el("span", "", place), el("span", "", date));
    face.append(image, caption);
    card.append(face);
    return card;
  }

  function noteCard(note) {
    const date = dateLabel(note.date);
    const title = `《${note.title || "未命名笔记"}》`;
    const type = note.type || "笔记";
    const card = cardShell(`笔记${title} · ${type} · ${date}`);
    const face = el("div", "orbit-face orbit-face--front orbit-face--note");
    face.append(
      el("span", "orbit-note-label", `笔记摘录 · ${date}`),
      el("strong", "", title),
      el("span", "orbit-note-foot", `${type} / Note`)
    );
    card.append(face);
    return card;
  }

  // 转到后半圈时露出的“相纸背面”：不写字，只透出镜像、虚化的照片，像隔着相纸看到的影子。
  function backFace(card) {
    const back = el("div", "orbit-face orbit-face--back");
    const front = card.querySelector(".orbit-face--front img");
    if (front) {
      const ghost = document.createElement("img");
      ghost.className = "orbit-back-ghost";
      ghost.src = front.getAttribute("src");
      if (front.dataset.fallbackSrc) ghost.dataset.fallbackSrc = front.dataset.fallbackSrc;
      ghost.alt = "";
      ghost.decoding = "async";
      ghost.loading = "lazy";
      ghost.draggable = false;
      back.append(ghost);
    } else {
      back.classList.add("orbit-face--back-note");
    }
    return back;
  }

  const TILT = 9 * Math.PI / 180; // 镜头俯视的角度
    const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  window.applyHeroRandom = function applyHeroRandom() {
    const visual = document.querySelector(".hero-visual");
    const orbit = visual && visual.querySelector(".hero-orbit");
    const ring = orbit && orbit.querySelector(".hero-orbit-ring");
    if (!ring || orbit.dataset.initialized) return;
    orbit.dataset.initialized = "true";

    const generated = selections.map((photo, i) => photoCard(photo, i === 0));
    // 笔记排在第二张，首屏一眼就能看到它在右手边。
    if (selectedNote) generated.splice(Math.min(1, generated.length), 0, noteCard(selectedNote));
    // 索引不可用时，继续使用 HTML 中的静态卡片。
    if (generated.length) ring.replaceChildren(...generated);
    const cards = Array.from(ring.querySelectorAll(".orbit-card"));
    const count = cards.length;
    if (!count) return;
    const step = Math.PI * 2 / count;
    cards.forEach((card, i) => {
      card.style.setProperty("--i", i);
      card.append(backFace(card));
    });

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // 地面：轨道、每张卡片的接触阴影和轨道上的刻度珠，都按卡片的真实位置投影出来。
    const mark = orbit.querySelector(".hero-orbit-mark");
    const floor = orbit.querySelector(".hero-orbit-floor");
    const gradient = svgEl("radialGradient", { id: "hero-orbit-shade" });
    gradient.append(svgEl("stop", { offset: "0", "stop-opacity": "1" }), svgEl("stop", { offset: "1", "stop-opacity": "0" }));
    const defs = svgEl("defs");
    defs.append(gradient);
    const track = svgEl("path", { class: "orbit-track" });
    const shadows = cards.map(() => svgEl("ellipse", { class: "orbit-shadow", fill: "url(#hero-orbit-shade)" }));
    const beads = cards.map(() => svgEl("circle", { class: "orbit-bead" }));
    floor.replaceChildren(defs, track, ...shadows, ...beads);

    let radius = 0;
    let floorY = 0;
    let cardW = 0;
    let cardH = 0;
    let lift = 0;
    let perspective = 1;
    let originX = 0;
    let originY = 0;

    // 与 CSS 完全相同的变换：rotateX(-TILT) → translateZ(-radius) → 透视投影。
    function project(x, y, z) {
      const y1 = y * Math.cos(TILT) + z * Math.sin(TILT);
      const z1 = -y * Math.sin(TILT) + z * Math.cos(TILT) - radius;
      const scale = perspective / (perspective - z1);
      return { x: originX + x * scale, y: originY + y1 * scale, scale };
    }

    function layout() {
      const width = orbit.clientWidth;
      if (!width) return;
      const tan = Math.tan(Math.PI / Math.max(count, 4));
      const gap = Math.max(12, width * 0.028);
      // 先让整圈刚好放进容器；窄屏时给卡片保底宽度，两侧允许被裁掉。
      cardW = Math.min(250, 2 * width * 0.45 * tan - gap);
      cardW = Math.round(Math.max(cardW, Math.min(width * 0.4, 170), 96));
      cardH = Math.round(cardW * 1.3);
      radius = Math.max((cardW + gap) / (2 * tan), cardW * 0.75);
      // 地面比卡片下沿低一点：卡片悬在转盘上方，轨道上的点刚好露在每张卡片正下方。
      floorY = cardH / 2 + Math.max(8, Math.round(cardW * 0.05));
      lift = cardW * 0.12;
      perspective = radius * 4 + 600;
      originX = width / 2;
      originY = 0;
      const top = -project(0, -cardH / 2, -radius).y;
      const bottom = Math.max(project(0, cardH / 2, radius + lift).y, project(0, floorY, radius).y);
      // 描边字放在后排卡片上沿之上，整圈转起来也不会挡住它。
      const markSize = mark && getComputedStyle(mark).display !== "none" ? Math.round(cardW * 0.42) : 0;
      originY = Math.round(top + (markSize ? markSize + 26 : 18));
      const height = Math.ceil(originY + bottom + 20);

      orbit.style.height = `${height}px`;
      orbit.style.setProperty("--card-w", `${cardW}px`);
      orbit.style.setProperty("--card-h", `${cardH}px`);
      orbit.style.setProperty("--orbit-perspective", `${Math.round(perspective)}px`);
      orbit.style.setProperty("--orbit-origin-y", `${originY}px`);
      orbit.style.setProperty("--mark-size", `${markSize}px`);
      floor.setAttribute("viewBox", `0 0 ${width} ${height}`);

      const points = [];
      for (let k = 0; k < 96; k += 1) {
        const t = k / 96 * Math.PI * 2;
        const p = project(radius * Math.sin(t), floorY, radius * Math.cos(t));
        points.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
      }
      track.setAttribute("d", `M${points.join("L")}Z`);
    }

    let angle = 0;
    let target = 0;
    let velocity = 0;
    let frame = 0;
    let lastTime = 0;
    let current = -1;

    const wrap = (index) => ((index % count) + count) % count;
    const snap = (value) => Math.round(value / step) * step;

    function setCurrent(index) {
      if (current >= 0) {
        cards[current].classList.remove("is-current");
        beads[current].classList.remove("is-current");
      }
      current = index;
      cards[index].classList.add("is-current");
      beads[index].classList.add("is-current");
    }

    function render() {
      ring.style.transform = `translateZ(${(-radius).toFixed(1)}px) rotateX(${-TILT}rad) rotateY(${angle}rad)`;
      const half = cardW / 2;
      cards.forEach((card, i) => {
        const turn = i * step + angle;
        const sin = Math.sin(turn);
        const cos = Math.cos(turn);
        // 只有正前方那张会浮起来一点，邻居几乎不动。
        const z = radius + lift * Math.pow(Math.max(0, cos), 16);
        card.style.transform = `rotateY(${i * step}rad) translateZ(${z.toFixed(1)}px)`;
        card.style.setProperty("--facing", cos.toFixed(3));

        const left = project(-half * cos + z * sin, floorY, half * sin + z * cos);
        const right = project(half * cos + z * sin, floorY, -half * sin + z * cos);
        const cx = (left.x + right.x) / 2;
        const cy = (left.y + right.y) / 2;
        const scale = (left.scale + right.scale) / 2;
        const shadow = shadows[i];
        shadow.setAttribute("cx", cx.toFixed(1));
        shadow.setAttribute("cy", cy.toFixed(1));
        shadow.setAttribute("rx", (Math.hypot(right.x - left.x, right.y - left.y) / 2 + 8 * scale).toFixed(1));
        shadow.setAttribute("ry", (8 * scale).toFixed(1));
        shadow.setAttribute("transform", `rotate(${(Math.atan2(right.y - left.y, right.x - left.x) * 180 / Math.PI).toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);

        // 刻度点固定在圆环半径上，正对每张卡片下沿的中点。
        const bead = project(radius * sin, floorY, radius * cos);
        beads[i].setAttribute("cx", bead.x.toFixed(1));
        beads[i].setAttribute("cy", bead.y.toFixed(1));
        beads[i].setAttribute("r", ((i === current ? 4 : 2.4) * bead.scale).toFixed(2));
      });
      const nearest = wrap(Math.round(-angle / step));
      if (nearest !== current) setCurrent(nearest);
    }

    // 轻微欠阻尼的弹簧：拖拽甩出去的速度会自然衰减，停下前带一点回弹。
    function tick(now) {
      const dt = Math.max(0, Math.min((now - lastTime) / 1000, 1 / 30));
      lastTime = now;
      velocity += ((target - angle) * stiffness - velocity * damping) * dt;
      angle += velocity * dt;
      if (Math.abs(target - angle) < 0.0004 && Math.abs(velocity) < 0.004) {
        angle = target;
        velocity = 0;
        frame = 0;
        render();
        return;
      }
      render();
      frame = requestAnimationFrame(tick);
    }

    // 按钮、方向键用偏快的弹簧；甩出去时换成更软的，让惯性滑行看得见。
    let stiffness = 110;
    let damping = 17;
    function settle(next, glide = false) {
      target = next;
      stiffness = glide ? 42 : 110;
      damping = glide ? 2 * Math.sqrt(stiffness) : 17;
      if (reduceMotion.matches) {
        stop();
        angle = target;
        render();
        return;
      }
      if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      velocity = 0;
    }

    // 往右一张（delta = 1）就是让右手边的卡片转到正前方。
    const goBy = (delta) => settle(snap(target) - delta * step);
    const goTo = (index) => settle(-index * step + Math.PI * 2 * Math.round((target + index * step) / (Math.PI * 2)));

    layout();
    render();
    if (count < 2) return;

    const controls = visual.querySelector(".hero-orbit-controls");
    let drag = null;
    controls.hidden = false;
    controls.querySelector("[data-orbit-prev]").addEventListener("click", () => goBy(-1));
    controls.querySelector("[data-orbit-next]").addEventListener("click", () => goBy(1));

    if ("ResizeObserver" in window) {
      let lastWidth = orbit.clientWidth;
      new ResizeObserver(() => {
        if (orbit.clientWidth === lastWidth) return;
        lastWidth = orbit.clientWidth;
        layout();
        render();
      }).observe(orbit);
    }

    // 圆环获得焦点后，方向键左右转动。
    orbit.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      goBy(event.key === "ArrowRight" ? 1 : -1);
    });

    // 点两侧的卡片把它转到正前方；拖拽结束时的那次点击直接忽略。
    let suppressClick = false;
    orbit.addEventListener("click", (event) => {
      const card = event.target.closest(".orbit-card");
      if (!suppressClick && card && card !== cards[current]) goTo(cards.indexOf(card));
      suppressClick = false;
    });

    // 触控板横向滚动（或 Shift + 滚轮）转动圆环，竖向滚动仍留给页面。
    let wheelTimer = 0;
    orbit.addEventListener("wheel", (event) => {
      if (event.ctrlKey || drag || !radius) return;
      const horizontal = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!horizontal || (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(horizontal))) return;
      event.preventDefault();
      stop();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? orbit.clientWidth : 1;
      angle -= horizontal * unit / radius;
      target = angle;
      render();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => settle(snap(angle)), 140);
    }, { passive: false });

    // 拖拽：卡片跟着手指沿圆周走（位移 / 半径 = 转角），松手时按速度甩出去再吸附。
    orbit.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || !radius) return;
      stop();
      target = angle;
      drag = { id: event.pointerId, x: event.clientX, angle, moved: false, samples: [{ x: event.clientX, t: event.timeStamp }] };
    });
    orbit.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) < 6) return;
        // 超过阈值才捕获指针，单纯的点击仍然落在卡片上。
        drag.moved = true;
        try { orbit.setPointerCapture(event.pointerId); } catch (error) { /* 指针已经结束时忽略 */ }
        orbit.classList.add("is-dragging");
      }
      // 只留最近 150ms 的轨迹，松手时用它算手指真实的速度。
      const samples = drag.samples;
      samples.push({ x: event.clientX, t: event.timeStamp });
      while (samples.length > 2 && samples[0].t < event.timeStamp - 150) samples.shift();
      angle = target = drag.angle + dx / radius;
      render();
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const { moved, samples, angle: startAngle } = drag;
      drag = null;
      if (moved) {
        orbit.classList.remove("is-dragging");
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        // 速度取松手前 100ms 内的平均值；手指抬起前常会本能地减速一两帧，
        // 所以再参考这段时间里的峰值速度（打个折），甩动不会被最后几帧“吃掉”。
        // 停住超过 100ms 再松手时窗口里没有位移，自然不甩。
        // pointercancel 说明浏览器接管了手势，坐标不可靠，只吸附不甩。
        let flick = 0;
        if (event.type === "pointerup") {
          samples.push({ x: event.clientX, t: event.timeStamp });
          const last = samples[samples.length - 1];
          const recent = samples.filter((sample) => sample.t >= last.t - 100);
          const span = (last.t - recent[0].t) / 1000;
          if (span > 0.012) {
            const average = (last.x - recent[0].x) / span;
            let peak = 0;
            for (let k = 1; k < recent.length; k += 1) {
              const dt = (recent[k].t - recent[k - 1].t) / 1000;
              if (dt > 0.004) {
                const speed = (recent[k].x - recent[k - 1].x) / dt;
                if (Math.sign(speed) === Math.sign(average) && Math.abs(speed) > Math.abs(peak)) peak = speed;
              }
            }
            const speed = Math.abs(peak) * 0.65 > Math.abs(average) ? peak * 0.65 : average;
            flick = Math.max(-14, Math.min(14, speed / radius));
          }
        }
        // 惯性滑行的距离约等于速度 × 0.38 秒，和系统列表的手感接近。
        let next = snap(angle + flick * 0.38);
        // 明确的一次轻扫至少翻过一张，不会又弹回原来那张。
        const startStep = Math.round(startAngle / step);
        if (Math.abs(flick) > 0.6 && Math.round(next / step) === startStep) next = (startStep + Math.sign(flick)) * step;
        velocity = flick;
        settle(next, flick !== 0);
      }
    }
    orbit.addEventListener("pointerup", endDrag);
    orbit.addEventListener("pointercancel", endDrag);
  };
})();
