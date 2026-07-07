# Chen 的实验台

这是一个个人静态 blog，用来记录阅读笔记、小项目、内容更新和暂未开放的相册记录。

站点使用原生 HTML、CSS 和 JavaScript 构建，通过 GitHub Pages 发布。

## 内容结构

- `content/notes/`：阅读笔记和经验记录
- `content/repos/`：个人项目记录
- `content/gallery/`：相册记录与图片素材
- `content/updates/`：内容更新历史和模板更新历史

## 本地预览

更新内容后，先重新生成内容索引：

```bash
python3 generate-content-index.py
```

然后启动本地服务：

```bash
python3 -m http.server 8000
```

打开：

```text
http://localhost:8000/
```

## 说明

这是个人记录站点，内容和样式会随使用过程持续调整。
