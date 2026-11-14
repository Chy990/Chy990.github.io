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

修改旧笔记时不需要改文件名。保存后重新双击 `start-blog.command`，
脚本会识别正文变化并记录刷新清单的日期；笔记按最近更新或创建日期排列，
卡片和详情仍显示文件名里的创建日期，同时标注「更新于」日期。
生成的 `content-index.js` 和 `content-index.json` 会保存识别变化所需的记录，
发布网站时请连同笔记一起提交。首次启用时只建立记录，不会把已有笔记都标记为更新。

笔记文件名建议使用：

```text
yyyy_mm_dd_type_title.md
```

例如：

```text
2026_06_02_notes_ios2oppo.md
```
