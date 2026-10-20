// 电脑端模拟测试：验证时间边界和脚本收尾，不代替 Android/ColorOS 实机测试。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../phone/run.js'), 'utf8');
const stopSource = fs.readFileSync(path.join(__dirname, '../phone/stop.js'), 'utf8');
const api = require('../phone/run.js');
const baseConfig = () => JSON.parse(JSON.stringify(api.config));

function harness(options = {}) {
    let wall = new Date(2026, 9, 19, 9, 0).getTime(); // 周一，手机本地时区
    let mono = 0;
    let held = false;
    const disk = new Map();
    const state = {acquires: [], releases: 0, lockReleases: 0, closes: 0, launches: 0,
        swipes: 0, logs: [], exitHandlers: [], locked: !!options.locked,
        secure: !!options.secure, pkg: 'launcher', on: true};
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [wall])); }
        static now() { return wall; }
    }
    const sandbox = {
        module: {exports: {}}, Date: ClockDate,
        console: {log: s => state.logs.push(s), error: s => state.logs.push(s)},
        toast: () => {}, toastLog: s => state.logs.push(s),
        engines: {myEngine: () => ({cwd: () => '/phone'})},
        files: {
            join: path.posix.join, ensureDir: () => {}, exists: p => disk.has(p),
            read: p => { if (!disk.has(p)) throw Error('ENOENT'); return disk.get(p); },
            write: (p, s) => disk.set(p, s), remove: p => disk.delete(p),
            append: (p, s) => disk.set(p, (disk.get(p) || '') + s)
        },
        java: {io: {RandomAccessFile: function () {
            this.getChannel = () => ({tryLock: () => {
                if (options.duplicate || held) throw Error('OverlappingFileLockException');
                held = true;
                return {release: () => { held = false; state.lockReleases++; }};
            }, close: () => state.closes++});
            this.close = () => state.closes++;
        }}, util: {UUID: {randomUUID: () => 'run-123'}}},
        android: {os: {SystemClock: {elapsedRealtime: () => mono}}},
        events: {on: (_, fn) => state.exitHandlers.push(fn)},
        auto: {service: options.noAccessibility ? null : {}},
        app: {
            getPackageName: () => options.missingApp ? null : 'example.target',
            launchPackage: pkg => {
                state.launches++;
                if (options.launchThrows) throw Error('launch exception');
                if (options.launchFalse) return false;
                if (!options.blockedLaunch) state.pkg = pkg;
                return true;
            }
        },
        device: {
            release: '12', model: 'mock', width: 1080, height: 2400,
            keepScreenOn: timeout => { state.acquires.push(timeout); state.on = true; },
            cancelKeepingAwake: () => state.releases++, isScreenOn: () => state.on
        },
        currentPackage: () => state.pkg,
        swipe: () => { state.swipes++; if (!options.swipeFails) state.locked = false; return true; },
        sleep: ms => {
            assert.ok(ms > 0 && ms <= 500);
            mono += ms; wall += ms;
            if (options.tick) options.tick({mono, state, sandbox, disk, stop,
                changeWall: delta => { wall += delta; }});
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox); // 此时无 Android context，只导出函数。
    sandbox.context = {
        getFilesDir: () => ({getAbsolutePath: () => '/private'}),
        getSystemService: () => ({isKeyguardLocked: () => state.locked, isKeyguardSecure: () => state.secure})
    };
    function stop() { vm.runInContext(stopSource, sandbox); }
    const config = baseConfig();
    config.testStartDelaySeconds = 0;
    config.testDurationMinutes = 0.1;
    config.launchTimeoutSeconds = 1;
    config.foregroundGraceSeconds = 1;
    return {state, disk, config, sandbox, stop,
        run: () => sandbox.module.exports.main(config),
        elapsed: () => mono, held: () => held};
}

test('拒绝无效时间、空星期、零时长及错误模式', () => {
    for (const mutate of [c => c.schedule.start = '25:00', c => c.schedule.weekdays = [],
        c => c.schedule.weekdays = [7], c => c.schedule.end = c.schedule.start,
        c => c.testDurationMinutes = 0, c => c.mode = 'forever']) {
        const c = baseConfig(); mutate(c); assert.throws(() => api.validateConfig(c));
    }
});

test('固定窗口包含开始、不包含结束；迟到不延长', () => {
    const c = baseConfig(); c.mode = 'window';
    assert.equal(api.planAt(c, new Date(2026, 9, 19, 8, 59)), null);
    assert.ok(api.planAt(c, new Date(2026, 9, 19, 9, 0)));
    assert.equal(api.planAt(c, new Date(2026, 9, 19, 9, 50)).endMs, new Date(2026, 9, 19, 10).getTime());
    assert.equal(api.planAt(c, new Date(2026, 9, 19, 10)), null);
    assert.equal(api.planAt(c, new Date(2026, 9, 18, 9)), null); // 周日
});

test('跨午夜按开始日星期判断，包括跨周', () => {
    const c = baseConfig(); c.mode = 'window';
    c.schedule = {start: '23:00', end: '01:00', weekdays: [0]};
    assert.ok(api.planAt(c, new Date(2026, 9, 18, 23, 0))); // 周日
    assert.ok(api.planAt(c, new Date(2026, 9, 19, 0, 30))); // 周一凌晨
    assert.equal(api.planAt(c, new Date(2026, 9, 19, 1, 0)), null);
    assert.equal(api.planAt(c, new Date(2026, 9, 19, 23, 30)), null);
});

test('正常结束只获取并释放一次亮屏锁，退出事件重复触发也不重复清理', () => {
    const h = harness();
    assert.equal(h.run().status, 'COMPLETED');
    assert.equal(h.state.acquires.length, 1);
    assert.equal(h.state.acquires[0], 6000);
    assert.equal(h.elapsed(), 6000);
    h.state.exitHandlers.forEach(fn => fn());
    assert.equal(h.state.releases, 1);
    assert.equal(h.state.lockReleases, 1);
    assert.equal(h.held(), false);
    assert.equal(h.disk.has('/private/local-screen-session-v1/session.json'), false);
});

test('stop.js 的实际代码可中断运行并清理', () => {
    let sent = false;
    const h = harness({tick: ({mono, stop}) => { if (!sent && mono >= 2000) { sent = true; stop(); } }});
    assert.equal(h.run().status, 'STOPPED');
    assert.ok(h.elapsed() <= 2250);
    assert.equal(h.state.releases, 1);
});

test('重复启动不会触碰其他会话的亮屏锁', () => {
    const h = harness({duplicate: true});
    assert.equal(h.run().status, 'DUPLICATE');
    assert.equal(h.state.acquires.length, 0);
    assert.equal(h.state.releases, 0);
    assert.equal(h.state.launches, 0);
});

test('窗口外不会唤醒或启动应用', () => {
    const h = harness(); h.config.mode = 'window'; h.config.schedule.start = '09:30';
    assert.equal(h.run().status, 'SKIPPED');
    assert.equal(h.state.acquires.length, 0);
    assert.equal(h.state.launches, 0);
});

for (const [name, options, acquired] of [
    ['无障碍未开启', {noAccessibility: true}, false],
    ['应用不存在', {missingApp: true}, false],
    ['安全锁屏', {locked: true, secure: true}, false],
    ['启动返回失败', {launchFalse: true}, true],
    ['启动抛异常', {launchThrows: true}, true],
    ['后台拉起被拦截', {blockedLaunch: true}, true],
    ['滑动锁屏未配置', {locked: true}, true]
]) test(name + '：有限失败并释放本会话资源', () => {
    const h = harness(options);
    assert.equal(h.run().status, 'ERROR');
    assert.equal(h.state.acquires.length, acquired ? 1 : 0);
    assert.equal(h.state.releases, acquired ? 1 : 0);
    assert.equal(h.held(), false);
});

test('显式启用后仅尝试一次无密码滑动解锁', () => {
    const h = harness({locked: true}); h.config.unlockSwipe = true;
    assert.equal(h.run().status, 'COMPLETED');
    assert.equal(h.state.swipes, 1);
    const secure = harness({locked: true, secure: true}); secure.config.unlockSwipe = true;
    assert.equal(secure.run().status, 'ERROR');
    assert.equal(secure.state.swipes, 0);
});

test('无密码解锁失败不继续启动应用', () => {
    const h = harness({locked: true, swipeFails: true}); h.config.unlockSwipe = true;
    assert.equal(h.run().status, 'ERROR');
    assert.equal(h.state.swipes, 1);
    assert.equal(h.state.launches, 0);
    assert.equal(h.state.releases, 1);
});

test('手动熄屏后停止且不重新获取亮屏锁', () => {
    const h = harness({tick: ({mono, state}) => { if (mono >= 2000) state.on = false; }});
    assert.equal(h.run().status, 'ERROR');
    assert.equal(h.state.acquires.length, 1);
    assert.equal(h.state.releases, 1);
});

test('短暂切换容忍，持续离开则停止且不抢回前台', () => {
    const transient = harness({tick: ({mono, state}) => {
        if (mono >= 1500 && mono < 2000) state.pkg = 'other';
        if (mono >= 2000) state.pkg = 'example.target';
    }});
    assert.equal(transient.run().status, 'COMPLETED');
    const away = harness({tick: ({mono, state}) => { if (mono >= 1500) state.pkg = 'other'; }});
    assert.equal(away.run().status, 'ERROR');
    assert.equal(away.state.launches, 1);
});

test('权限在运行期间被撤销会结束', () => {
    const h = harness({tick: ({mono, sandbox}) => { if (mono >= 2000) sandbox.auto.service = null; }});
    assert.equal(h.run().status, 'ERROR');
    assert.equal(h.state.releases, 1);
});

test('残留会话和旧停止请求不会阻止新任务', () => {
    const h = harness();
    h.disk.set('/private/local-screen-session-v1/session.json', JSON.stringify({runId: 'old'}));
    h.disk.set('/private/local-screen-session-v1/stop.txt', 'old');
    assert.equal(h.run().status, 'COMPLETED');
    assert.ok(h.state.logs.some(s => s.includes('RECOVER')));
});

test('测试倒计时期间也能停止，无需取得亮屏锁', () => {
    const h = harness({tick: ({mono, stop}) => { if (mono === 500) stop(); }});
    h.config.testStartDelaySeconds = 10;
    assert.equal(h.run().status, 'STOPPED');
    assert.equal(h.state.acquires.length, 0);
});

test('固定窗口遇到时间前跳立即结束；回拨也不能无限延长', () => {
    let changed = false;
    const h = harness({tick: ({mono, changeWall}) => {
        if (!changed && mono >= 2000) { changed = true; changeWall(3600000); }
    }});
    h.config.mode = 'window';
    assert.equal(h.run().status, 'COMPLETED');
    assert.ok(h.elapsed() <= 2500);
    assert.equal(h.state.releases, 1);
    assert.equal(api.clockReached({fixedWindow: true, endMs: 10000}, 5000, 10000, 10000), true);
    assert.equal(api.clockReached({fixedWindow: false, endMs: 10000}, 20000, 5000, 10000), false);
});
