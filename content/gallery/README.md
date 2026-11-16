# 相册

每个相册是一篇 Markdown（只写一段引言）加一个同名文件夹（放照片）。详情页显示为：引言 + 全部照片的缩略图网格，点开任意一张可以左右翻看。

推荐结构：

```text
content/gallery/
  20260621吉林.md
  20260621吉林/
    1-flight-home.jpg
    2-field-wind.jpg
    3-field-cat.jpg
```

文件名规则：

- `相册名.md`
- `相册名/`

两者名字需要一致。比如 `20260621吉林.md` 对应 `20260621吉林/`。

Markdown 写法：

```md
---
date: 2026-06-21
place: 吉林
cover: 20260621吉林/1-flight-home.jpg
---

# 吉林

这次回老家，照片没有刻意拍得很完整……（一段引言）
```

照片不用写进 Markdown：

- 运行 `start-blog.command`（或 `python3 generate-content-index.py`）时，会自动扫描同名文件夹里的 `.jpg` / `.jpeg` / `.png`。
- 按文件名的自然顺序排列（`mel2` 排在 `mel10` 前面）。想调整顺序，就给文件名加数字前缀，比如 `1-xxx.jpg`、`2-xxx.jpg`。
- `cover` 可以不写，默认用第一张做封面。
- `.HEIC` 等其他格式会被忽略，可以和原图放在一起。

缩略图由 `generate-gallery-thumbnails.py` 生成，原图不会被修改：

- `_grid/`：短边 480px，用在详情页网格里。
- `_thumbs/`：长边 1600px，用在相册卡片、首页和灯箱打开时的过渡图。
