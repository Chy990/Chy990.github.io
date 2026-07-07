# 相册

每个相册使用一篇 Markdown 记录，图片放在相册自己的文件夹里。

推荐结构：

```text
content/gallery/
  2026_07_07_trip_mountain_weekend.md
  mountain-weekend/
    cover.jpg
    night-sky.jpg
    forest-light.jpg
```

Markdown 文件名需要使用：

```text
yyyy_mm_dd_trip_album-name.md
```

也可以把 `trip` 换成 `album`。

Markdown 开头写相册信息：

```md
---
date: 2026-07-07
place: Mountain Weekend
cover: mountain-weekend/cover.jpg
---
```

插入图片：

```md
![山间夜空|portrait](mountain-weekend/night-sky.jpg)
![林间光线|wide](mountain-weekend/forest-light.jpg)
```

图片标记可以使用 `wide`、`portrait` 或 `square`，用来调整详情页里的展示宽度。
