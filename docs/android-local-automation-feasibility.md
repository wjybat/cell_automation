# 安卓手机本地定时启动应用与保持亮屏：可行性调研

调研日期：2026-10-16。设备条件：OPPO，具体型号及 Android / ColorOS 构建号待确认；长期接电，可取消锁屏密码；按未 root、允许首次手动授予权限设计。本次完成文档与源码调研，尚未连接手机或运行实机测试。

## 1. 结论与推荐路线

**技术上可行，适合先在这一台手机上做本地自动化原型。** 核心流程是：按时间触发 → 点亮屏幕并确认可操作 → 打开指定应用 → 在规定时间内维持亮屏 → 释放亮屏状态并停止执行。无障碍可以生成滑动，现有自动化工具也提供应用启动、定时和亮屏能力。无需首先采用 root 或让电脑持续连接。[Android 无障碍服务](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)、[AutoJs6 项目](https://github.com/SuperMonster003/AutoJs6)

这是基于平台能力的可行性判断，不是对所有 OPPO 机型的兼容保证。“最新版”不足以锁定运行环境：实现时需要记录具体型号、系统构建号、自动化工具版本和目标应用版本。

**推荐：AutoJs6 + 本地 JavaScript 做原型，优先直接保持亮屏，滑动作为可选后备。** 如果只是想最快配置出流程，可使用 Automate；当需要独立安装包、完善配置界面、长期日志和多种任务时，再考虑 Kotlin 原生应用。选择顺序属于本项目的工程判断。

手机亮屏、目标应用在前台、应用联网、服务端认定用户在线是不同指标。本次可以验证前两项；不能据此承诺钉钉或飞书的在线状态、考勤或其他业务状态。目标应用的业务判定不在已核实资料范围内。

## 2. 路线比较

| 路线 | 本地运行与开发方式 | 适合程度 | 主要限制 |
| --- | --- | --- | --- |
| AutoJs6 | 安装脚本运行器，在手机本地执行 JavaScript；支持无障碍及 APK 打包 | 最适合当前“自己写脚本、以后扩展” | 亮屏接口和定时调度需要实测；脚本打包不等于绕过系统限制 |
| Automate / Tasker | 本地配置时间条件、应用启动、亮屏及退出动作 | 适合快速验证或少量规则 | 仍受系统权限与后台策略限制；复杂状态管理维护成本会上升 |
| Kotlin 原生 APK | 自己实现调度、服务、配置、持久化和恢复 | 适合长期维护的工具 | 工作量较大；原生开发也没有跨应用自动化的特殊豁免 |
| 普通 Python / Shell 脚本 | 需要运行环境及 Android 能力桥接 | 不作为首选 | 单有脚本语言不能获得跨应用触摸、后台拉起等权限；仍需无障碍、ADB 或其他授权路径 |

能力来源：[AutoJs6 README](https://github.com/SuperMonster003/AutoJs6)、[Automate 应用启动](https://llamalab.com/automate/doc/block/activity_start.html)、[Automate 时间等待](https://llamalab.com/automate/doc/block/time_await.html)、[Tasker 时间条件](https://tasker.joaoapps.com/userguide/en/timecontext.html)、[Tasker 息屏时间](https://tasker.joaoapps.com/userguide/en/help/ah_screen_timeout.html)。适合程度为工程评估，不代表已测试这些工具在当前手机上的表现。

## 3. 保持亮屏：先避免无意义触摸

### 3.1 普通 Android 代码容易踩的坑

`FLAG_KEEP_SCREEN_ON` 用于应用自己的 Activity；当自己的 Activity 进入后台时，不能凭它保证前台的钉钉、飞书继续亮屏。`PARTIAL_WAKE_LOCK` 只维持 CPU 工作，屏幕仍可关闭。前台服务也不自动等于屏幕常亮。[屏幕常亮指南](https://developer.android.com/develop/background-work/background-tasks/awake/screen-on)、[PowerManager](https://developer.android.com/reference/android/os/PowerManager)

### 3.2 三种优先验证的亮屏方式

1. **运行器的限时亮屏接口。** AutoJs6 提供 `device.keepScreenOn(timeout)` 和 `device.cancelKeepingAwake()`；其文档提示某些设备上不带超时参数的常亮可能在切换应用后失效。源码使用 `SCREEN_BRIGHT_WAKE_LOCK | ACQUIRE_CAUSES_WAKEUP`，其中相关 API 已被 Android 弃用，因此应当视作待实机验证的兼容方案。弃用不代表已经删除。[AutoJs6 设备文档](https://github.com/SuperMonster003/AutoJs6/blob/master/app/src/main/assets-app/docs/device.html)、[实现源码](https://github.com/SuperMonster003/AutoJs6/blob/master/app/src/main/java/org/autojs/autojs/runtime/api/Device.java)、[Android 电源接口](https://developer.android.com/reference/android/os/PowerManager)
2. **临时调大系统息屏时间。** 用户授予“修改系统设置”访问后，可评估修改 `SCREEN_OFF_TIMEOUT`。执行前持久化原值，结束时恢复；设备策略会限制其最大值，不能假设写入任意大数就一定生效。这是候选方案，必须验证实际持续亮屏时间、异常退出后的恢复，以及用户中途更改设置时如何避免覆盖。[Settings.System](https://developer.android.com/reference/android/provider/Settings.System)
3. **充电时保持唤醒。** Android 开发者选项提供 Stay awake，适合本设备长期接电的早期验证。这个全局开关不会随脚本结束自动关闭，不能单独满足“只在指定时段亮屏”。正式方案若要求之后恢复正常息屏，就不要永久依赖这个开关；若只要求脚本停止、允许手机继续亮屏，则它能明显简化方案。该选项是否在当前 ColorOS 暴露，需要查看实机。[开发者选项](https://developer.android.com/studio/debug/dev-options)

修改息屏时间或维持亮屏并不等于从熄屏中唤醒，也不等于解锁。启动阶段应单独检查这些状态。释放亮屏状态一般只是恢复自动息屏条件，不代表立即锁屏。[AutoJs6 设备文档](https://github.com/SuperMonster003/AutoJs6/blob/master/app/src/main/assets-app/docs/device.html)、[Android 锁屏接口](https://developer.android.com/reference/android/app/KeyguardManager)

### 3.3 如果确实需要滑动

Android 从 API 24 提供无障碍 `dispatchGesture()`，服务声明 `canPerformGestures` 并由用户启用后可以发出手势。手势发往当前屏幕，且可能取消正在进行的其他手势。[AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)

以下是据此提出的设计约束，尚未实测：

- 先确认目标应用和已知页面仍在前台，再执行手势；出现其他窗口或无法识别状态时暂停。
- 不存在对所有页面都无副作用的“小滑动”。列表滑动可能刷新、切页；距离过短可能被当成点击；通知、键盘或弹窗也可能占据原坐标。
- 若用手势延缓息屏，间隔必须小于已验证的有效息屏时间并留余量；不能直接假定“每隔几分钟滑一下”有效。
- 单独验证模拟手势能否在该设备上重置空闲计时。能完成手势回调，不等于已证明亮屏目标达成。
- 不在未知页面盲目重试；为每个目标应用维护可验证的页面条件和区域。

对于当前只要求保持屏幕显示的目标，直接控制亮屏可以减少上述页面副作用，因此优先级更高。

## 4. 定时、锁屏与后台运行

**定时要交给持久化调度。** 不应让脚本 `sleep` 到第二天，或仅依赖进程内 `setTimeout`。AutoJs6 的普通定时器基于 Looper/Handler，文档不承诺精确回调；应使用所选版本的持久化定时任务，并在手机上验证精确闹钟授权及重启恢复。原生实现则评估 `AlarmManager`、精确闹钟访问和启动广播。[AutoJs6 普通定时器](https://github.com/SuperMonster003/AutoJs6/blob/master/app/src/main/assets-app/docs/timers.html)、[持久化任务调度源码](https://github.com/SuperMonster003/AutoJs6/blob/master/app/src/main/java/org/autojs/autojs/timing/TimedTaskScheduler.kt)、[Android 闹钟指南](https://developer.android.com/develop/background-work/services/alarms/schedule)

**到点收到事件，不等于可以打开界面。** Android 限制后台启动 Activity；当前官方列出的例外包括可见窗口、用户授予的 `SYSTEM_ALERT_WINDOW` 等。不能仅凭“开启无障碍”或“有前台服务”就承诺任意系统上都能拉起界面。运行器必须符合适用条件，随后还要检查应用是否真的显示在前台。[后台启动限制](https://developer.android.com/guide/components/activities/secure-bal)

**安全锁屏是无人值守的主要障碍。** 普通应用不能无条件绕过 PIN、密码或生物识别。用户已表示可取消密码，所以原型可在“无安全锁屏或已人工解锁”的条件下验证；仍需确认是否存在滑动锁屏、目标应用锁或工作资料锁。只点亮屏幕不足以证明已进入可操作状态。[KeyguardManager](https://developer.android.com/reference/android/app/KeyguardManager)

**长期接电有利，但不是进程存活保证。** Android Doze 的经典进入条件包括未接电、静止和息屏；接电可减少这类限制，但不能据此排除 ColorOS 自身管理、强行停止、权限撤销和重启造成的中断。[Doze 与应用待机](https://developer.android.com/training/monitoring-device-state/doze-standby)

在手机上逐项查验：允许后台活动、自启动/关联启动（若系统提供）、电池优化设置、无障碍状态、闹钟和提醒访问、通知及停止入口。Android 13+ 的部分侧载安装还可能需要用户允许受限设置，才能启用无障碍。[Android 受限设置说明](https://support.google.com/android/answer/12623953?hl=zh-Hans)

以上 ColorOS 项目是**实机检查清单**，不假定所有型号都有相同开关或菜单路径。本次未取得能够覆盖用户具体版本的 OPPO 官方操作说明，不把网上其他型号教程当成已确认配置。应在计划长期使用的正式系统版本上完成验收，系统更新后复测。

更细的平台版本限制和依据见同目录 `android-platform-constraints.md`。

## 5. 建议的最小实现

配置只需要：目标应用标识、日期/星期、开始时间、结束时间或持续时长、时区、亮屏方式、失败策略。目标应用通过手机实际安装信息选择，避免硬编码可能变化的内部页面名称。

状态流程：

```text
等待计划 → 检查权限和锁屏 → 唤醒并打开目标应用
         → 确认应用就绪 → 限时保持亮屏 → 清理并结束
任意失败 / 用户停止 / 超过截止时间 → 清理 → 记录原因
```

工程重点：

- 把调度、应用启动、亮屏和可选手势分开，方便后续替换工具或扩展应用。
- 运行前保存截止时间和恢复信息；同一计划只运行一份。
- 明确时间语义：“09:00–10:00”迟到启动仍在 10:00 结束；“成功打开后运行一小时”按实际启动计时。可用单调时钟度量持续时长，避免校时造成运行异常。
- 为唤醒锁设置有限超时；正常停止和异常处理均释放资源。`finally` 无法覆盖进程被直接杀死，修改全局设置还需要持久化恢复记录及下一次启动修复。
- 停止意味着终止手势和本次运行、释放亮屏并恢复本程序修改的设置；默认不强行结束目标应用，也不强制锁屏。
- 保留本地日志：计划时间、实际触发时间、前台应用、锁屏/亮屏状态、失败原因、结束结果；提供一个明确的立即停止入口。

这些是建议设计，并非已实现功能。

## 6. 实机验收顺序

| 测试 | 要回答的问题 |
| --- | --- |
| 手动触发，目标应用前台保持 15–30 分钟 | 直接亮屏是否有效，页面是否保持稳定 |
| 熄屏后等待一次定时启动 | 能否唤醒、越过非安全锁屏并显示目标应用 |
| 接电闲置一晚后自动启动 | 长时间无人操作后，调度和服务是否还可用 |
| 连续运行至预定截止时间 | 是否及时停止，是否恢复原设置 |
| 弹窗、通知、人工切换应用 | 是否停止不确定的手势，避免误操作 |
| 重启、进程回收、手工强行停止、权限撤销 | 区分可恢复情形与必须人工重新启动/授权的情形 |
| 连续多个完整日程 | 记录启动偏差、漏执行、停止偏差和资源恢复情况 |

计时精度应由实际需求确定，例如允许几十秒偏差还是必须尽量贴近指定秒数；不预先承诺系统级实时精度。完成上述验证后，再决定是否值得投入原生 APK。

当前尚缺：OPPO 具体型号及 ColorOS 版本、首个目标应用和停留页面、日程规则、允许的启动偏差，以及结束后是否需要立即息屏。它们不阻止可行性判断，但会影响最终实现与验收标准。
