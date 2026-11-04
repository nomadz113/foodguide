package cn.dailyintake.app;

import android.app.Activity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 启动层退场信号：前端「第一帧画出来了」→ 原生能把盖在 WebView 上的启动层淡出。
 *
 * <h3>为什么需要这个插件</h3>
 * 启动屏以前是一个独立 Activity：播 2 秒 → startActivity(MainActivity) → finish。
 * 它退场时 WebView 一行字都还没画（内核初始化 + 加载入口 + 解析 JS + 打开 IndexedDB +
 * 播种食物库都要时间），于是中间露出几秒近黑的窗口底色 —— 这就是「logo 之后黑屏」。
 * <p>
 * 两个 Activity 之间没法握手（后启动的那个还没建好，先启动的就必须收工），
 * 所以把启动层搬进 MainActivity 做成覆盖层，由**真正知道准备进度的一方**（前端）
 * 在首帧提交后回调这里，原生才撤。撤的时机是对的，黑屏就不存在了。
 * <p>
 * 浏览器 / 网页版没有这个原生层：前端一律 try-catch 吞掉，不产生任何影响。
 */
@CapacitorPlugin(name = "Splash")
public class SplashPlugin extends Plugin {

    @PluginMethod
    public void ready(PluginCall call) {
        Activity act = getActivity();
        if (act instanceof MainActivity) {
            // 走到主线程再动 View：插件调用本来就在主线程，这里是防御性写法
            act.runOnUiThread(() -> ((MainActivity) act).hideSplash());
        }
        // 无论如何都 resolve：前端不关心结果，也不必为它写错误分支
        call.resolve();
    }
}
