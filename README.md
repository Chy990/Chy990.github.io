# Chen 的实验台

**在线预览：<https://chy990.github.io/>**

一个用原生 HTML、CSS 和 JavaScript 手写的个人站点，用来记录阅读笔记、小项目、内容更新和旅行相册。通过 GitHub Pages 发布。

## 设计

站点采用「纸上档案馆 × 液态玻璃」的混合设计方向：

- 暖纸底色、墨色正文、朱砂红作为唯一强调色
- 宋体负责标题与长文阅读，无衬线负责界面，等宽字体负责日期、编号与元信息
- 用细规则线、栏目编号和错落的图版建立秩序；卡片与控件使用半透明玻璃和大圆角
- 悬停时卡片轻微上浮、阴影与边框加强；点击时从指针位置扩散一圈涟漪，并伴随轻微回弹
- 首屏使用站内真实相册照片，不再依赖外部图库
- 笔记是圆角索引卡，仓库是编号索引卡，相册是 7 / 5 / 12 的图版节奏
- 支持浅色 / 深色主题（会记住选择）、阅读进度、图片灯箱和全页阅读模式
- 尊重 `prefers-reduced-motion` 与 `prefers-reduced-transparency`

主要设计变量集中在 `styles.css` 顶部：`--paper`、`--ink`、`--accent`、`--glass`、`--radius-*`、`--font-serif` 等。

## 内容结构

- `content/notes/`：阅读笔记和经验记录
- `content/repos/`：个人项目记录
- `content/gallery/`：相册记录与图片素材
- `content/updates/`：内容更新历史和模板更新历史

## 本地预览

更新内容后，先重新生成内容索引和相册缩略图：

```bash
python3 generate-content-index.py
python3 generate-gallery-thumbnails.py
```

然后启动本地服务：

```bash
python3 -m http.server 8000
```

打开：

```text
http://localhost:8000/
```

也可以直接双击 `start-blog.command`，它会自动完成上述步骤并在 `http://127.0.0.1:4173/` 启动。

## 发布

- 在 GitHub Desktop 里提交并 Push 后，GitHub Pages 会直接发布仓库根目录，不需要构建。
- 首次发布时，在 GitHub 仓库的 **Settings → Pages → Build and deployment** 里选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`。
- `.nojekyll` 不要删除：它让 `content/gallery/_thumbs/` 这种以下划线开头的目录也能被原样发布。
- 如果仓库名是 `chy990.github.io`，访问地址就是 <https://chy990.github.io/>。

## 图片体积

`content/gallery/<album>/` 里是相册原图，供灯箱查看；`content/gallery/_thumbs/` 是页面实际加载的缩略图。原图比较重，如果以后接近 GitHub Pages 的 1GB 站点上限，可以只保留缩略图，或把原图转成 web 尺寸。

## 说明

这是个人记录站点，内容和样式会随使用过程持续调整。
