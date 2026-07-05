# 内容目录

这个文件夹用来放你的个人内容。

- `notes/`：笔记 Markdown 文件。
- `repos/`：仓库/小项目 Markdown 文件。
- `gallery/`：相册图片，支持 `.jpg`、`.jpeg`、`.png`。
- `updates/`：最近更新历史 Markdown 文件。

页面不会再要求你手动维护 `index.json`。

以后新增或删除内容时：

1. 把 `.md` 或图片放进对应目录，或者直接删除不要的文件。
2. 重新双击 `start-blog.command`。
3. 脚本会自动运行 `generate-content-index.py`，刷新页面使用的内容清单。

笔记文件名建议使用：

```text
yyyy_mm_dd_type_title.md
```

例如：

```text
2026_06_02_notes_ios2oppo.md
```
