# YOLO Realtime Detector

### GitHub 仓库

[待补充 GitHub 仓库链接](https://example.com)

### 简介

YOLO Realtime Detector 是一个基于 Tkinter、OpenCV 和 Ultralytics YOLO 的实时摄像头检测小工具，用来快速调用本机或外接摄像头，并在可视化窗口中实时显示检测结果。

它适合用来验证 YOLO 模型效果，也适合作为桌面端实时视觉检测工具的原型。

### 功能

- 相机选择：支持电脑自带摄像头和外接摄像头。
- 模型选择：支持目标检测、姿态检测和分割检测。
- 硬件选择：支持 `cuda`、`mps` 和 `cpu`，默认会根据当前平台自动选择。
- 可视化窗口会实时显示检测结果。
- 点击开始后会锁定选项；如需更换选项，请关闭程序后重新打开。

### 文件结构

```text
.
├── main.py
├── README.md
└── models
    ├── yolo26n.pt
    ├── yolo11n-pose.pt
    └── yolo26n-seg.pt
```

### 运行

先确认已安装依赖：

```bash
pip install ultralytics opencv-python numpy
```

然后运行：

```bash
python main.py
```

### 说明

- macOS Apple Silicon 通常会默认选择 `mps`。
- NVIDIA 显卡环境通常可选择 `cuda`。
- 如果摄像头无法打开，请检查系统摄像头权限，或切换相机选项后重启程序。
