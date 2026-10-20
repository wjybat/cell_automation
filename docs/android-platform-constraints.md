# 安卓本地定时自动化：平台约束核实

调研日期：2026-10-16。范围：OPPO 手机、不 root、长期接电、允许手工授权，可取消锁屏密码。以下依据 Android 官方文档；Android 版本、应用 targetSdk 与 ColorOS 版本是不同变量，不能把“可以更新”理解成该机型已支持某个最新 Android 版本。

## 1. 到点执行与拉起应用是两件事

Android 10 起限制后台启动 Activity。当前官方列出的例外包括可见窗口、用户授权的 `SYSTEM_ALERT_WINDOW` 等。因此，定时回调成功不代表钉钉或飞书能自动出现在前台；前台服务也不应被当作任意启动界面的通行证。实现时需要独立验证“触发成功”和“目标应用实际进入前台”。[官方后台启动规则](https://developer.android.com/guide/components/activities/secure-bal)

若通过 `PendingIntent` 拉起界面，targetSdk 34 起发送方、targetSdk 35 起创建方涉及显式授予后台启动权限；授予动作本身仍不能凭空创造权限。Android 16 提供相关 StrictMode 检测。官方旧文档地址已重定向，新例外表没有直接枚举 `AccessibilityService`：不能仅凭旧教程承诺“开无障碍后任意版本都能后台拉起”。**需实机确认**自动化框架的调用链、悬浮窗授权及 ColorOS 行为。[权限传递与调试](https://developer.android.com/guide/components/activities/secure-bal)

## 2. 定时建议使用系统闹钟

严格起止时间适合 `AlarmManager`，不适合单纯让脚本睡眠到明天。Android 12 引入精确闹钟权限；Android 14 及以后，新安装且 targetSdk ≥33 的多数应用不预授予 `SCHEDULE_EXACT_ALARM`，需要用户在特殊访问权限中授予，并用 `canScheduleExactAlarms()` 检查。`USE_EXACT_ALARM` 面向符合条件的闹钟/日历用途，不能视作通用替代品。[Android 14 精确闹钟变更](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)

重复闹钟自 API 19 起为非精确；要求每天准确执行时，可逐次安排下一次一次性精确闹钟。关机会清除闹钟，重启后须读取持久化计划并重新安排。**设计建议**同时保存开始时间、截止时间与会话状态，处理时间/时区改变；恢复时已经超过截止时间就清理退出，不补做一整段任务。[调度、时钟选择与重启恢复](https://developer.android.com/develop/background-work/services/alarms)

## 3. 唤醒屏幕不等于解锁

`requestDismissKeyguard()` 自 API 26 可用。无安全锁或处于可信状态时可以直接解除锁屏；有安全锁且不可信时只会显示凭据输入界面，不能替用户绕过密码。调用者还须具有符合要求的可见 Activity。**本场景建议**既然允许取消密码，使用无安全锁的专用闲置机配置，仍实测是否保留滑动锁屏、SIM PIN 或工作资料独立锁。[KeyguardManager 官方定义](https://developer.android.com/reference/android/app/KeyguardManager#requestDismissKeyguard(android.app.Activity,%20android.app.KeyguardManager.KeyguardDismissCallback))

## 4. 接电降低休眠问题，但不保证进程永生

原生 Doze 针对未接电、熄屏且闲置的设备；连接电源会退出 Doze，也会释放 App Standby 限制。长期接电是本需求的重要有利条件。断电后，普通闹钟包括 `setExact()` 可能延后，需休眠中触发时考虑 `setExactAndAllowWhileIdle()`。**推断**正常接电期间不必用频繁滑动来“对抗 Doze”；ColorOS 的额外管理效果仍待实测。[Doze 与 App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)

Android 12 起，targetSdk ≥31 的应用从后台启动前台服务也受到限制；执行用户要求的精确闹钟任务属于例外之一。Android 15 起，若依赖悬浮窗权限这一前台服务启动例外，还要求当前确实存在可见悬浮窗，不能与后台 Activity 的例外条件混为一谈。[前台服务后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)

长期任务可设计为用户可见、可停止的前台服务；Android 14 起还要按适用要求声明服务类型及权限。无法归入其他类型的合法用途可以评估 `specialUse`，并声明具体用途，而非伪装成播放音频或定位。[前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)

系统可回收缓存进程，`onDestroy()` 不保证执行。因此不能只靠退出回调恢复设置；应记录原设置并设计下次启动时的补偿清理。**需实机确认**ColorOS 下授权后隔夜启动、重启恢复、任务中杀进程，以及结束时间到达后的恢复行为。[进程生命周期](https://developer.android.com/guide/components/activities/process-lifecycle)

## 验收重点

在实际型号及安装包版本上，记录计划触发时间、实际触发时间、实际前台包名、锁屏状态与结束原因。至少验证接电熄屏隔夜启动、手动切换应用、断电、重启和权限撤销；连续多日通过后，才把无人值守可靠性视为已验证。以上是工程验收建议，并非官方平台承诺。
