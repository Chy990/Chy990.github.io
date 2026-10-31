# Chen 的实验台

**在线预览：<https://chy990.github.io/>**

一个记录阅读笔记、个人项目、旅行相册和日常更新的个人博客。

## 个人社交链接

打开 `index.html`，搜索“社交链接”，在个人板块找到 GitHub 和 Instagram 对应的 `<a>` 标签。修改其中 `href` 引号里的完整网址，例如 `href="https://github.com/你的用户名"` 或 `href="https://www.instagram.com/你的用户名/"`，不需要改动后面的 SVG 图标。

保留 `hidden`，网页加载时会自动显示填有完整 `https://` 或 `http://` 网址的链接；留空的链接不会显示。要添加其他社媒，可以复制一整个 `<a>...</a>` 标签，修改网址、`aria-label`、`title`，并将其中的 SVG 换成对应平台的图标。保存后刷新页面查看；发布到线上需要按原有流程更新网站。
