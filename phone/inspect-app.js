/* 运行后 8 秒内手动切到目标应用，从 AutoJs6 日志查看包名。 */
if (!auto.service) {
    toastLog("请先开启 AutoJs6 无障碍服务");
} else {
    toast("请在 8 秒内切换到目标应用");
    sleep(8000);
    var packageName = String(currentPackage());
    toastLog("当前应用包名：" + packageName);
    var output = files.join(String(engines.myEngine().cwd()), "detected-app.txt");
    files.write(output, "targetPackage: \"" + packageName + "\"\n");
    console.log("包名已保存到：" + output);
}
