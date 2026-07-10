# 相册

每个相册使用一篇 Markdown 记录，图片放在同名文件夹里。

推荐结构：

```text
content/gallery/
  20260621吉林.md
  20260621吉林/
    cover.jpg
    field-wind.jpg
    field-cat.jpg
```

文件名规则：

- `相册名.md`
- `相册名/`

两者名字需要一致。比如 `20260621吉林.md` 对应 `20260621吉林/`。

Markdown 开头写相册信息：

```md
---
date: 2026-06-21
place: 吉林
cover: 20260621吉林/flight-home.jpg
---
```

插入图片：

```md
![飞回东北|wide](20260621吉林/flight-home.jpg)
![地里的小猫|portrait](20260621吉林/field-cat.jpg)
```

图片标记可以使用 `wide`、`portrait` 或 `square`，用来调整详情页里的展示宽度。
