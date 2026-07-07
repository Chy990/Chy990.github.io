# USYD Assessment Extractor

### GitHub 仓库

[Chy990/20250313_usyd_tasks_extractor](https://github.com/Chy990/20250313_usyd_tasks_extractor)

### 简介

这是一个用于提取 University of Sydney 指定 unit assessment 信息的小工具，可以根据用户选择的年份、学期和 unit code，自动访问对应的 USYD unit 页面，并整理 assessment table 中的作业、考试、权重、截止时间、长度和 AI 使用要求等信息。

与手动逐个打开课程页面、复制表格内容相比，它可以把查询结果统一保存为 `task_info.html`，方便集中查看和后续整理。程序也会保留一份 Markdown 格式的中间文件，便于继续编辑或重新生成 HTML 页面。

### 主要特点

- 支持按年份、学期和 unit code 查询 USYD unit assessment 信息。
- 自动提取 assessment table 中的类型、描述、权重、截止时间、长度和 AI 使用要求。
- 查询结果会追加保存到 `task_info.html`，方便直接用浏览器查看。
- 使用 `resources/task_info.md` 保存 Markdown 数据，便于后续整理和转换。
- 提供图形界面，可以直接输入 unit code、打开结果或清除已有结果。
- 会检测已提取过的 unit，避免重复写入相同课程信息。
