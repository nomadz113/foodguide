package cn.dailyintake.app;

import android.animation.ValueAnimator;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.animation.DecelerateInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;

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
 *
 * <h3>启动层为什么也在类里（0.6.7 起）</h3>
 * 旧做法是 SplashActivity 播 2 秒 → 起 MainActivity → finish。它退场的那一刻
 * WebView 还一片空白（内核初始化 + 加载入口 + 解析 JS + 打开 IndexedDB + 播种食物库），
 * 中间露出几秒近黑的窗口底色 —— 用户看到的就是「logo 之后黑屏」。
 * 根因不是慢，是**没有握手**：两个 Activity 之间，先启动的那个没法等后启动的准备好。
 * 现在启动层是贴在 WebView 上方的一个普通 View，等前端提交首帧后回调
 * {@link SplashPlugin} → {@link #hideSplash()} 才淡出。撤场时机由真正知道进度的一方决定。
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

    /* ── 启动层 ───────────────────────────────────────────────────
       时间三个数各有分工：
       MIN —— 品牌动画至少播完（图标淡入 520ms，文字块从 120ms 起错峰浮起，
              最后一行 400ms 才起步、380ms 收尾 ≈ 800ms；再留出扫描线扫完一遍），
              首帧来得太快也不能一闪而过，否则像闪屏故障；
       MAX —— 前端万一初始化失败（异常页 / JS 崩了 / 旧网页没发信号），
              宁可交出界面也不能把用户锁在 logo 上；
       FADE —— 撤场用淡出而不是切走。切走会露出底部 WebView 的第一帧，
              哪怕那边已经画好了，硬切也有「跳一下」的感觉。 */
    private static final long SPLASH_MIN_MS = 1800;
    /* 只给 4 秒不是抠时间：只有「新壳 + 旧网页」这种错配（在线版网页还没部署新版本）
       才会走到这条兜底路径，那时页面本身也在正常加载，4 秒足够覆盖；
       再长就成了「为了防呆把所有人都拖慢」。 */
    private static final long SPLASH_MAX_MS = 4000;
    private static final long SPLASH_FADE_MS = 280;
    private static final long ART_FADE_MS = 520;
    private static final long TEXT_MS = 380;
    /** 文字块顶端对应设计稿 1068/1920 —— 取景框下沿（1010）再留 58px */
    private static final float TEXT_TOP_RATIO = 0.556f;

    private final Handler mUi = new Handler(Looper.getMainLooper());
    private View mSplash;
    private SplashView mSplashArt;
    private View mSplashText;
    private long mSplashAt;
    private boolean mSplashGone;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册：Bridge 是在那里建立插件表的
        registerPlugin(CameraProbePlugin.class);
        registerPlugin(SplashPlugin.class);
        super.onCreate(savedInstanceState);
        // 启动层紧跟着 super 之后挂上：Bridge 已经建好 WebView（拿得到内容根视图），
        // 但页面还在下载/解析，这正是要盖住的那一段
        showSplash();
        tintWebView();
        setupInsets();
    }

    /**
     * WebView 自己的底色跟着主题走。
     *
     * capacitor.config.json 里的 android.backgroundColor 是**一个写死的值**，
     * Bridge 在 super.onCreate 里就把它铺上去了（见 Bridge.java 的 webView.setBackgroundColor）。
     * 页面还没画出来那一瞬露出来的就是它：深色写死 = 浅色用户每次打开闪一下黑，
     * 正好是启动层藏了又露出来的那一段。这里在 super 之后按当前模式的 @color/win_bg 覆盖，
     * 顺理成章地和 res/values-night 对齐。
     */
    private void tintWebView() {
        if (mWeb == null) return;
        mWeb.setBackgroundColor(getResources().getColor(R.color.win_bg));
    }

    // ── 启动层 ─────────────────────────────────────────────────────

    /**
     * 挂在 android.R.id.content 的最上层（那是个 FrameLayout，后加的在上）。
     *
     * 不塞进 WebView 内部、也不改 Capacitor 的布局：这里动 View 树很容易把
     * edge-to-edge 的 insets 让位挤坏（见类注释里的历史教训），加一个兄弟节点最干净。
     */
    private void showSplash() {
        ViewGroup content = findViewById(android.R.id.content);
        if (content == null) return;

        View v = getLayoutInflater().inflate(R.layout.activity_splash, content, false);
        content.addView(v, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        mSplash = v;
        mSplashArt = v.findViewById(R.id.splashArt);
        mSplashText = v.findViewById(R.id.splashText);
        mSplashAt = SystemClock.uptimeMillis();
        mSplashGone = false;

        v.post(() -> {
            if (mSplashGone || isFinishing()) return;
            placeText();
            playEntrance();
        });

        mUi.postDelayed(this::hideSplash, SPLASH_MAX_MS);
    }

    /** 文字的纵向位置依赖实测高度（16:9 与 20:9 的屏高差很多），测量完再定位 */
    private void placeText() {
        if (mSplashText == null || mSplashArt == null) return;
        ViewGroup.LayoutParams raw = mSplashText.getLayoutParams();
        if (!(raw instanceof FrameLayout.LayoutParams)) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) raw;
        lp.topMargin = Math.round(mSplashArt.getHeight() * TEXT_TOP_RATIO);
        mSplashText.setLayoutParams(lp);
    }

    private void playEntrance() {
        if (!animatorsEnabled()) {
            if (mSplashArt != null) mSplashArt.setReveal(1f);
            if (mSplashText != null) mSplashText.setAlpha(1f);
            return;
        }

        if (mSplashArt != null) {
            ValueAnimator fade = ValueAnimator.ofFloat(0f, 1f);
            fade.setDuration(ART_FADE_MS);
            fade.setInterpolator(new DecelerateInterpolator(1.6f));
            fade.addUpdateListener(a -> {
                if (mSplashArt != null) mSplashArt.setReveal((float) a.getAnimatedValue());
            });
            fade.start();
            mSplashArt.startOrbit();
        }

        if (mSplashText != null) mSplashText.setAlpha(1f);
        /* 错峰浮起：标语 → 署名 → 能力行 → 心电线 → 底部说明。
           顺序就是阅读顺序，间隔 60~70ms —— 再密会变成「一起淡入」，
           再疏会让最后一行在启动层撤场时还没浮到位。 */
        rise(findViewById(R.id.splashSlogan), 120);
        rise(findViewById(R.id.splashBrand), 190);
        rise(findViewById(R.id.splashFeats), 260);
        rise(findViewById(R.id.splashEcg), 330);
        rise(findViewById(R.id.splashTrust), 400);
    }

    /** 单行文字：淡入 + 上移 10dp。方向朝上，视觉上是「浮起来」而不是「落下来」 */
    private void rise(View v, long delay) {
        if (v == null) return;
        v.setAlpha(0f);
        v.setTranslationY(getResources().getDisplayMetrics().density * 10f);
        v.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(delay)
            .setDuration(TEXT_MS)
            .setInterpolator(new DecelerateInterpolator())
            .start();
    }

    /** 前端首帧就绪（SplashPlugin.ready）或超时兜底都会走到这里，必须幂等 */
    public void hideSplash() {
        if (mSplashGone || mSplash == null) return;

        // 首帧来得太早也要把品牌动画播完：这里只是「延后」，不是「取消」
        long shown = SystemClock.uptimeMillis() - mSplashAt;
        if (shown < SPLASH_MIN_MS) {
            mUi.postDelayed(this::hideSplash, SPLASH_MIN_MS - shown);
            return;
        }

        mSplashGone = true;
        mUi.removeCallbacksAndMessages(null);

        final View v = mSplash;
        mSplash = null;

        if (!animatorsEnabled()) {
            if (mSplashArt != null) mSplashArt.stopOrbit();
            detach(v);
            return;
        }
        v.animate()
            .alpha(0f)
            .setDuration(SPLASH_FADE_MS)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> {
                if (mSplashArt != null) mSplashArt.stopOrbit();
                detach(v);
            })
            .start();
    }

    private void detach(View v) {
        ViewGroup p = (ViewGroup) v.getParent();
        if (p != null) p.removeView(v);
        mSplashArt = null;
        mSplashText = null;
    }

    private static boolean animatorsEnabled() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled();
    }

    /** 必须是 public：BridgeActivity 里就是这么声明的，收窄可见性编译不过 */
    @Override
    public void onDestroy() {
        mUi.removeCallbacksAndMessages(null);
        if (mSplashArt != null) mSplashArt.stopOrbit();
        super.onDestroy();
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
