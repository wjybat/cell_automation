/* 在同一个 AutoJs6 中运行，只停止本项目当前会话；不会停止其他脚本。 */
(function () {
    var dir = files.join(String(context.getFilesDir().getAbsolutePath()), "local-screen-session-v1");
    var path = files.join(dir, "session.json");
    if (!files.exists(path)) { toastLog("没有本项目的运行中会话"); return; }
    try {
        var session = JSON.parse(files.read(path));
        if (!session.runId) throw new Error("会话信息无效");
        files.write(files.join(dir, "stop.txt"), session.runId);
        toastLog("已发送停止请求；正常运行的脚本会在约 1 秒内处理。请以日志 END STOPPED 为准。");
    } catch (e) {
        toastLog("读取会话失败，请稍后重试，或在 AutoJs6 运行管理中停止 run.js：" + e);
    }
})();
