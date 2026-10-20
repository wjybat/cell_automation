/* AutoJs6 6.7.0 / Android 12 / 无 root。保存到手机后运行，不要使用 Node 运行手机任务。 */
var CONFIG = {
    mode: "test",                 // test: 短时测试；window: 固定时间窗口
    targetAppName: "飞书",        // 可改为 "钉钉"，注意不是“叮叮”
    targetPackage: "",            // 通常留空，按名称解析；重名/分身时填写实际包名
    testDurationMinutes: 3,        // 从测试倒计时结束算起，包含应用启动时间
    testStartDelaySeconds: 10,     // 仅测试模式；给你时间返回桌面，最大 120 秒
    schedule: {
        start: "09:00",
        end: "10:00",            // 可跨午夜，例如 23:00 → 01:00
        weekdays: [1, 2, 3, 4, 5] // 1=周一，…，6=周六，0=周日；按开始日判断
    },
    unlockSwipe: false,           // 仅无密码但保留滑动锁屏时改 true；不会输入密码
    launchTimeoutSeconds: 20,
    foregroundGraceSeconds: 10    // 持续离开目标应用超过此时间就结束，不自动抢回前台
};

function parseTime(value) {
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new Error("时间必须是 HH:mm，例如 09:00");
    }
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function validateConfig(c) {
    if (!c || (c.mode !== "test" && c.mode !== "window")) throw new Error("mode 只能为 test 或 window");
    if (typeof c.targetAppName !== "string" || typeof c.targetPackage !== "string" ||
            (!c.targetAppName.trim() && !c.targetPackage.trim())) throw new Error("请填写目标应用名称或包名");
    function range(name, min, max) {
        if (typeof c[name] !== "number" || !isFinite(c[name]) || c[name] < min || c[name] > max) {
            throw new Error(name + " 必须在 " + min + " 到 " + max + " 之间");
        }
    }
    range("testDurationMinutes", 0.1, 120);
    range("testStartDelaySeconds", 0, 120);
    range("launchTimeoutSeconds", 1, 120);
    range("foregroundGraceSeconds", 1, 120);
    if (typeof c.unlockSwipe !== "boolean") throw new Error("unlockSwipe 必须为 true 或 false");
    if (!c.schedule || parseTime(c.schedule.start) === parseTime(c.schedule.end)) {
        throw new Error("开始与结束时间不能相同");
    }
    var days = c.schedule.weekdays;
    if (!Array.isArray(days) || !days.length || days.some(function (d) {
        return typeof d !== "number" || d % 1 !== 0 || d < 0 || d > 6;
    })) throw new Error("weekdays 必须是 0 到 6 的非空数字数组");
}

// 结束边界不包含在窗口内；跨午夜的星期归属开始日。全部按手机本地时间。
function planAt(c, now) {
    if (c.mode === "test") return {endMs: now.getTime() + c.testDurationMinutes * 60000, fixedWindow: false};
    var startMinutes = parseTime(c.schedule.start);
    var endMinutes = parseTime(c.schedule.end);
    for (var offset = -1; offset <= 0; offset++) {
        var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset,
            Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
        var end = new Date(start.getFullYear(), start.getMonth(),
            start.getDate() + (endMinutes < startMinutes ? 1 : 0),
            Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
        if (c.schedule.weekdays.indexOf(start.getDay()) >= 0 && now >= start && now < end) {
            return {endMs: end.getTime(), fixedWindow: true};
        }
    }
    return null;
}

function clockReached(plan, wallNow, elapsedNow, elapsedEnd) {
    return elapsedNow >= elapsedEnd || (plan.fixedWindow && wallNow >= plan.endMs);
}

function main(c) {
    var handle = null, channel = null, lock = null, wakeOwned = false, cleaned = false;
    var paths = null, runId = null, logFile = null, result = "INTERRUPTED";
    var detail = "脚本被停止或中断", session = null;
    function stamp() { return new Date().toISOString(); }
    function elapsed() { return Number(android.os.SystemClock.elapsedRealtime()); }
    function record(message) {
        var line = stamp() + " " + message;
        console.log(line);
        if (logFile) {
            try { files.append(logFile, line + "\n"); }
            catch (e) { console.error("日志写入失败: " + e); }
        }
    }
    function readJson(path) {
        try { return files.exists(path) ? JSON.parse(files.read(path)) : null; }
        catch (e) { return null; } // 另一个脚本可能正在写入，下一轮再读。
    }
    function cleanup() {
        if (cleaned) return;
        cleaned = true;
        if (wakeOwned) {
            try { device.cancelKeepingAwake(); }
            catch (e) { record("RELEASE_ERROR " + e); }
            wakeOwned = false;
        }
        if (lock) {
            try {
                var state = readJson(paths.session);
                if (state && state.runId === runId) files.remove(paths.session);
                record("END " + result + " " + detail);
            } finally {
                try { lock.release(); } catch (ignored) {}
                lock = null;
            }
        }
        if (channel) { try { channel.close(); } catch (ignored2) {} }
        if (handle) { try { handle.close(); } catch (ignored3) {} }
    }
    function finish(code, message) { result = code; detail = message; }
    function stopRequested() {
        try { return files.exists(paths.stop) && files.read(paths.stop).trim() === runId; }
        catch (e) { return false; }
    }
    function checkStop() {
        if (stopRequested()) {
            var signal = new Error("收到 stop.js 的停止请求");
            signal.userStop = true;
            throw signal;
        }
    }
    try {
        validateConfig(c);
        var dir = engines.myEngine().cwd();
        if (!dir) throw new Error("请先保存 run.js 到手机目录，再从文件运行");
        var logDir = files.join(String(dir), "logs");
        files.ensureDir(logDir + "/");
        var today = new Date();
        logFile = files.join(logDir, today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate() + ".log");
        var stateDir = files.join(String(context.getFilesDir().getAbsolutePath()), "local-screen-session-v1");
        files.ensureDir(stateDir + "/");
        paths = {session: files.join(stateDir, "session.json"), stop: files.join(stateDir, "stop.txt")};
        // 内核文件锁：并发脚本不能重复启动；进程死亡后自动释放。不要删除锁文件。
        handle = new java.io.RandomAccessFile(files.join(stateDir, "session.lock"), "rw");
        channel = handle.getChannel();
        try { lock = channel.tryLock(); } catch (busy) {
            if (String(busy).indexOf("OverlappingFileLockException") < 0) {
                throw new Error("无法获取运行锁：" + busy);
            }
            lock = null;
        }
        if (!lock) {
            finish("DUPLICATE", "已有任务运行，未启动第二份");
            record(result + " " + detail);
            return {status: result, detail: detail};
        }
        events.on("exit", cleanup);
        if (files.exists(paths.session)) record("RECOVER 发现上次遗留状态；文件锁已可用，覆盖旧会话");
        runId = String(java.util.UUID.randomUUID().toString());
        session = {runId: runId, logFile: logFile, startedAt: stamp()};
        files.write(paths.session, JSON.stringify(session));
        record("START " + runId + " mode=" + c.mode + " Android=" + device.release + " model=" + device.model);
        record("LOCAL_TIME " + new Date().toString());

        if (c.mode === "test" && c.testStartDelaySeconds > 0) {
            toast("将在 " + c.testStartDelaySeconds + " 秒后启动；可返回桌面测试");
            var waitUntil = elapsed() + c.testStartDelaySeconds * 1000;
            while (elapsed() < waitUntil) { checkStop(); sleep(Math.max(1, Math.min(250, waitUntil - elapsed()))); }
        }
        checkStop();
        var plan = planAt(c, new Date());
        if (!plan) {
            finish("SKIPPED", "当前不在配置的时间窗口；本脚本不等待下一时段，请设置 AutoJs6 定时任务");
            return {status: result, detail: detail};
        }
        var remaining = plan.endMs - Date.now();
        var elapsedEnd = elapsed() + remaining;
        function expired() { return clockReached(plan, Date.now(), elapsed(), elapsedEnd); }
        function pause(ms) {
            var until = Math.min(elapsed() + ms, elapsedEnd);
            while (elapsed() < until && !expired()) { checkStop(); sleep(Math.max(1, Math.min(250, until - elapsed()))); }
        }
        if (!auto.service) throw new Error("无障碍服务未开启，请在系统设置中启用 AutoJs6 后重试");
        var pkg = c.targetPackage.trim() || app.getPackageName(c.targetAppName.trim());
        if (!pkg) throw new Error("找不到目标应用，请检查名称，或填写实际包名 targetPackage");
        pkg = String(pkg);
        var keyguard = context.getSystemService("keyguard");
        if (keyguard.isKeyguardLocked() && keyguard.isKeyguardSecure()) {
            throw new Error("手机处于安全锁屏；请先人工解锁，或为专用测试机取消安全锁屏");
        }
        remaining = Math.min(plan.endMs - Date.now(), elapsedEnd - elapsed());
        if (remaining <= 0) {
            finish("SKIPPED", "启动准备期间已到截止时间");
            return {status: result, detail: detail};
        }
        // 只 acquire 一次，设置有限超时；不用 wakeUp() 再重复 acquire。
        wakeOwned = true;
        device.keepScreenOn(Math.ceil(remaining));
        session.endAt = new Date(plan.endMs).toISOString();
        session.packageName = pkg;
        files.write(paths.session, JSON.stringify(session));
        record("WAKE target=" + pkg + " end=" + session.endAt);
        pause(800);
        if (keyguard.isKeyguardLocked()) {
            if (!c.unlockSwipe) throw new Error("仍有滑动锁屏；先手动解锁，或按说明启用 unlockSwipe");
            if (keyguard.isKeyguardSecure()) throw new Error("检测到安全锁屏，不执行解锁滑动");
            swipe(Math.round(device.width * 0.5), Math.round(device.height * 0.8),
                Math.round(device.width * 0.5), Math.round(device.height * 0.25), 400);
            pause(1000);
            if (keyguard.isKeyguardLocked()) throw new Error("一次滑动后仍未解锁；请人工处理，不继续尝试");
        }
        if (expired()) {
            finish("SKIPPED", "解锁阶段已到截止时间");
            return {status: result, detail: detail};
        }
        checkStop();
        if (app.launchPackage(pkg) === false) throw new Error("启动应用失败，请检查安装状态及包名");
        var launchEnd = Math.min(elapsedEnd, elapsed() + c.launchTimeoutSeconds * 1000);
        while (String(currentPackage()) !== pkg && elapsed() < launchEnd && !expired()) {
            pause(250);
        }
        if (expired()) {
            finish("SKIPPED", "应用启动阶段已到截止时间");
            return {status: result, detail: detail};
        }
        if (String(currentPackage()) !== pkg) throw new Error("未确认目标应用进入前台；检查后台弹出界面/悬浮窗授权和应用锁");
        record("FOREGROUND_CONFIRMED " + pkg);
        toast("已启动 " + c.targetAppName + "；保持亮屏中");
        var awaySince = null, nextHeartbeat = elapsed();
        while (!expired()) {
            checkStop();
            if (!auto.service) throw new Error("无障碍服务已断开");
            if (!device.isScreenOn()) throw new Error("屏幕已关闭；停止任务，不重新唤醒");
            if (keyguard.isKeyguardLocked()) throw new Error("运行期间重新锁屏，停止任务");
            var foreground = String(currentPackage());
            if (foreground !== pkg) {
                if (awaySince === null) { awaySince = elapsed(); record("AWAY " + foreground); }
                if (elapsed() - awaySince >= c.foregroundGraceSeconds * 1000) {
                    throw new Error("持续离开目标应用，停止任务；当前包名=" + foreground);
                }
            } else {
                if (awaySince !== null) record("RETURNED " + pkg);
                awaySince = null;
            }
            if (elapsed() >= nextHeartbeat) {
                record("HEARTBEAT screen=on foreground=" + foreground + " remainingSeconds=" + Math.ceil((elapsedEnd - elapsed()) / 1000));
                nextHeartbeat = elapsed() + 30000;
            }
            pause(500);
        }
        finish("COMPLETED", "已到截止时间，释放本脚本的亮屏状态");
    } catch (e) {
        finish(e.userStop ? "STOPPED" : "ERROR", String(e.message || e));
        record(result + " " + detail);
    } finally {
        cleanup();
        toast(result + "：" + detail);
    }
    return {status: result, detail: detail};
}

// 导出只用于电脑端逻辑测试；手机通过 AutoJs6 自动执行。
if (typeof context !== "undefined") {
    main(CONFIG);
} else if (typeof module !== "undefined") {
    module.exports = {config: CONFIG, validateConfig: validateConfig, planAt: planAt, clockReached: clockReached, main: main};
}
