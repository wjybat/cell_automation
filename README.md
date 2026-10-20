# 手机本地自动化

当前实现针对 OPPO Android 12、未 root 手机，使用 AutoJs6 v6.7.0 在本地按时打开应用并限时保持亮屏。

- 手机文件：[phone/run.js](phone/run.js)、[phone/stop.js](phone/stop.js)、[phone/inspect-app.js](phone/inspect-app.js)。
- 完整安装、权限、测试、定时和停止步骤：[手机使用说明](phone/使用说明.md)。
- 前期调研：[可行性报告](docs/android-local-automation-feasibility.md)、[平台约束](docs/android-platform-constraints.md)。

默认配置是飞书、10 秒后开始、运行 3 分钟。正式使用需要编辑 `run.js` 的 CONFIG，并在 AutoJs6 中创建对应定时任务。脚本不会自动注册手机定时任务。

## 电脑端验证

```sh
node --test tests/run.test.cjs
```

测试覆盖时间窗口、跨午夜、结束边界、重复启动、停止脚本、锁屏、启动失败、前台切换和资源清理。Android API 使用模拟对象，**通过测试不代表真机兼容性已经验证**。本仓库不需要 npm 依赖。
