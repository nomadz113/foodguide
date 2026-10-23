package cn.dailyintake.app;

import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 键盘 + 系统栏的让位，全部在这里做。
 *
 * ⚠️ 为什么必须接管 Capacitor 的 adjustMarginsForEdgeToEdge（已在 capacitor.config.json 里置为 disable）：
 * CapacitorWebView.edgeToEdgeHandler 干的事和这里一样 —— 给 WebView 设 MarginLayoutParams。
 * 同一个 View 只能挂一个 OnApplyWindowInsetsListener，挂第二个就把第一个顶掉：
 * 上一版正是在这里注册了键盘监听，把 Capacitor 那份系统栏让位挤没了，
 * 结果键盘好了、底栏却被手势条切掉（标题也拱到了状态栏下面）。
 * 两个需求抢同一个 bottomMargin，只能合到一处算：见 applyInsets() 里的 Math.max。
 */
public class MainActivity extends BridgeActivity {

    /** 小于这个高度不算键盘：状态栏收放、分屏拖动都会让可见区抖几十像素 */
    private static final int MIN_KEYBOARD_PX = 40;

    /** 「没有键盘」时被系统栏盖掉的那一段。取观测最小值，旋转/换导航栏都能自适应 */
    private int mCoveredBaseline = Integer.MAX_VALUE;

    private WebView mWeb;
    private int mImeFromInsets = 0;
    private int mImeFromLayout = 0;
    private int mAppliedKb = -1;

    /** 系统栏四边厚度（物理像素）。只有内容真的画到系统栏下面才用得上 */
    private int mBarTop = 0;
    private int mBarBottom = 0;
    private int mBarLeft = 0;
    private int mBarRight = 0;
    private boolean mBehindBars = false;
    private int mAppliedTop = -1;
    private int mAppliedBottom = -1;
    private int mAppliedLeft = -1;
    private int mAppliedRight = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册：Bridge 是在那里建立插件表的
        registerPlugin(CameraProbePlugin.class);
        super.onCreate(savedInstanceState);
        setupInsets();
    }

    /**
     * 键盘升起时把 WebView 压矮，系统栏（状态栏 / 手势条）那一段也一并让开。
     *
     * 为什么要补这一层：原来靠的三条链路 —— manifest 的 adjustResize、
     * viewport meta 的 interactive-widget=resizes-content、ui/keyboard.ts 的
     * visualViewport 差值 —— **都建立在「系统或浏览器会把键盘高度告诉 WebView」之上**。
     * 真机上这三条可以一起哑火（targetSdk 35 在 Android 15+ 会被强制 edge-to-edge，
     * adjustResize 直接失效；部分 ROM 的 WebView 也不转发 IME inset），
     * 表现就是点了输入框却看不见自己打了什么字。原生层拿到的 IME 高度是权威值，不依赖转发。
     */
    private void setupInsets() {
        mWeb = getBridge().getWebView();
        if (mWeb == null) return;
        final View content = findViewById(android.R.id.content);

        // 路一：WindowInsets（API 30+ 精确，低版本走 androidx 兼容实现）
        ViewCompat.setOnApplyWindowInsetsListener(mWeb, (v, insets) -> {
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            mImeFromInsets = ime == null ? 0 : ime.bottom;
            // 加上 displayCutout：横屏时挖孔那一侧也要让开
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            if (bars != null) {
                mBarTop = bars.top;
                mBarBottom = bars.bottom;
                mBarLeft = bars.left;
                mBarRight = bars.right;
            }
            applyInsets();
            return insets;
        });
        ViewCompat.requestApplyInsets(mWeb);

        // 路二：窗口可见区反推。某些 ROM 根本不往 View 树派发 inset，
        // 但可见区一定会被键盘压小 —— 这条不依赖任何 inset 转发。
        ViewTreeObserver obs = content.getViewTreeObserver();
        obs.addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() {
            @Override
            public void onGlobalLayout() {
                mBehindBars = drawingBehindSystemBars(content);
                int covered = coveredBelowContent(content);
                if (covered < mCoveredBaseline) mCoveredBaseline = covered;
                int kb = covered - mCoveredBaseline;
                mImeFromLayout = kb > MIN_KEYBOARD_PX ? kb : 0;
                applyInsets();
            }
        });
    }

    /**
     * 旋转/分屏后系统栏那一段会变，基线必须重新取。
     * 否则横屏的导航栏高度会被当成「键盘一直弹着」，界面永久少一截。
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        mCoveredBaseline = Integer.MAX_VALUE;
        mImeFromLayout = 0;
        mBarTop = 0;
        mBarBottom = 0;
        mBarLeft = 0;
        mBarRight = 0;
        mAppliedTop = -1;
        mAppliedBottom = -1;
        mAppliedLeft = -1;
        mAppliedRight = -1;
        if (mWeb != null) ViewCompat.requestApplyInsets(mWeb);
        applyInsets();
    }

    /**
     * 内容区是不是真的画到了系统栏下面。
     *
     * Android 15 + targetSdk 35 会**强制 edge-to-edge**：窗口铺满整块屏，
     * 状态栏和手势条直接压在页面上 —— 底栏的文字被切、标题顶到状态栏里。
     * 但老设备/老 ROM 上系统仍然会把窗口缩到系统栏之间，那时页面本来就没被压，
     * 再垫一次就是凭空多出一条黑边。所以垫不垫，取决于窗口有没有顶到物理屏的边缘。
     */
    private boolean drawingBehindSystemBars(View content) {
        DisplayMetrics real = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(real);
        int[] loc = new int[2];
        content.getLocationOnScreen(loc);
        int bottom = loc[1] + content.getHeight();
        return content.getHeight() > 0 && loc[1] <= 0 && bottom >= real.heightPixels - 1;
    }

    /** 内容区底部被（系统栏 + 键盘）盖掉的那一段，单位：物理像素 */
    private static int coveredBelowContent(View content) {
        Rect r = new Rect();
        content.getWindowVisibleDisplayFrame(r);
        int[] loc = new int[2];
        content.getLocationOnScreen(loc);
        int covered = (loc[1] + content.getHeight()) - r.bottom;
        return covered > 0 ? covered : 0;
    }

    /**
     * 底部要让开的那一段。inset 是权威值，但个别 ROM 不派发 ——
     * 这时用「可见区反推」的基线兜底：edge-to-edge 下它正好等于系统栏高度。
     */
    private int barBottom() {
        if (mBarBottom > 0) return mBarBottom;
        return mCoveredBaseline == Integer.MAX_VALUE ? 0 : mCoveredBaseline;
    }

    private void applyInsets() {
        if (mWeb == null) return;
        int kb = Math.max(mImeFromInsets, mImeFromLayout);
        if (kb < MIN_KEYBOARD_PX) kb = 0;

        int top = mBehindBars ? mBarTop : 0;
        int left = mBehindBars ? mBarLeft : 0;
        int right = mBehindBars ? mBarRight : 0;
        // ⚠️ 键盘不叠加系统栏：ime().bottom / 可见区差值都是从**物理屏底边**量的，
        // 已经把手势条那一段算进去了。取大值即可 —— 键盘升起时 kb 一定大于手势条。
        int bottom = Math.max(kb, mBehindBars ? barBottom() : 0);

        if (kb == mAppliedKb && top == mAppliedTop && bottom == mAppliedBottom
                && left == mAppliedLeft && right == mAppliedRight) return;
        mAppliedKb = kb;
        mAppliedTop = top;
        mAppliedBottom = bottom;
        mAppliedLeft = left;
        mAppliedRight = right;

        ViewGroup.LayoutParams lp = mWeb.getLayoutParams();
        // 用外边距而不是 padding：padding 里可能已经有系统给的安全区内边距，
        // 改它等于把状态栏一起挪了；margin 是干净叠加的。
        if (!(lp instanceof ViewGroup.MarginLayoutParams)) return;
        ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) lp;
        mlp.topMargin = top;
        mlp.leftMargin = left;
        mlp.rightMargin = right;
        mlp.bottomMargin = bottom;
        mWeb.setLayoutParams(mlp);

        // 暴露给前端：让位再出问题，能直接看出是哪条路、读到了多少
        float density = getResources().getDisplayMetrics().density;
        mWeb.evaluateJavascript(
            "window.__ime=" + kb
                + ";window.__imeInfo=JSON.stringify({kb:" + kb
                + ",insets:" + mImeFromInsets
                + ",layout:" + mImeFromLayout
                + ",base:" + (mCoveredBaseline == Integer.MAX_VALUE ? -1 : mCoveredBaseline)
                + ",navT:" + Math.round(top / density)
                + ",navB:" + Math.round((mBehindBars ? barBottom() : 0) / density)
                + ",behind:" + (mBehindBars ? 1 : 0)
                + ",inner:window.innerHeight,vv:"
                + "(window.visualViewport?Math.round(window.visualViewport.height):-1)});",
            null);
    }
}
