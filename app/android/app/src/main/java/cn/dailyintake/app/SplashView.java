package cn.dailyintake.app;

import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import androidx.annotation.ColorRes;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Build;
import android.util.AttributeSet;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * 启动屏主视觉：暖光 + 点阵 + 取景框 + 扫描线 + 轨道 + 图标本体。
 *
 * <h3>这一版和上一版的差别（0.8.8）</h3>
 * 上一版只有「图标 + 一圈轨道 + 一行字」，讲的是「这是个完成度圆环」，
 * 没讲这个 App 干什么。这一版把三件事画进构图里：
 * <ul>
 *   <li><b>拍照记录</b> —— 图标外面一圈取景框四角，加一条自上而下扫的光带。
 *       取景框只画角不画整框：完整的方框会被读成「图片占位框」。</li>
 *   <li><b>AI 识别</b> —— 轨道那枚读数头（沿用旧稿的动效，是品牌资产）。</li>
 *   <li><b>健康 / 健身 / 生活</b> —— 心电线由 {@link SplashEcgView} 画在文字块里，
 *       右上角一团暖光；品牌绿负责健康，暖光负责「生活」，两者都不靠插画。</li>
 * </ul>
 * 文字与三个能力图标都在 {@code activity_splash.xml} 里，不画在 Canvas 上：
 * 文本排版交给系统，字重、字号、字体缩放（无障碍）才能正常工作。
 *
 * <h3>为什么图标也画在这里，而不是用 ImageView</h3>
 * 轨道和扫描线都要绕/扫过图标。如果图标是 ImageView、图形是另一个 View，
 * 圆心和扫描范围就得靠布局算出来再同步过去 —— 一旦文字块的测量结果和预期差几像素，
 * 弧就会绕着一个偏心的点转。画在同一个 onDraw 里，它们共用一组 cx/cy，
 * 同心是结构上保证的，不依赖任何同步代码。
 *
 * <h3>为什么所有尺寸都是比例而不是 dp</h3>
 * 设计稿是 1080×1920，图标边长占屏宽 29.6%、取景框半边长 28.7%、轨道半径 22.2%。
 * 换 dp 固定值后，360dp 窄屏和 432dp 宽屏上图标与轨道的松紧关系会变
 * （轨道是比例、图标是定值，两者比例就漂了）。统一按宽/高比例算，
 * 任何屏幕的视觉构成都和设计稿一致。
 *
 * <h3>浓淡为什么不写死在这里</h3>
 * 光晕、取景框、扫描、点阵这些是「同一支绿，不同浓淡」的层。深底和浅底上
 * 同一支绿的合理浓淡差很多（深底的 0.16 光晕搬到白底上是一坨绿雾），
 * 所以浓淡放在 {@code res/values[-night]/colors.xml} 的 alpha 通道里，
 * 这里只负责取用 —— {@link #alphaOf(int)}。
 * 设计稿工具 {@code tools/render-splash.mjs} 读的是同一份 XML，
 * 于是「稿子」和「跑起来的那版」不会各走各的。
 *
 * <h3>点阵为什么要缓存成 Bitmap</h3>
 * 约 800 个点，每帧画一次在低端机上会让旋转掉帧。
 * 点阵本身不参与动画，画一次缓存起来，之后每帧只是一次 drawBitmap。
 */
public class SplashView extends View {

    /** 取自 res/values[-night]/colors.xml，见 init() */
    private int bg;
    private int brand;
    private int warm;
    private int glowCore;
    private int glowMid;
    private int frameColor;
    private int scanColor;
    private int bandColor;
    private int haloColor;
    private int dotColor;

    /* 全部来自 1080×1920 设计稿的实测值，除高度项外都以「视图宽」为基准 */
    private static final float ICON_W_RATIO = 0.2963f;     // 320 / 1080
    private static final float ICON_CY_RATIO = 0.3646f;    // 700 / 1920（相对高度）
    private static final float FRAME_HALF_RATIO = 0.2870f; // 310 / 1080
    private static final float FRAME_R_RATIO = 0.0704f;    // 76 / 1080（圆角）
    private static final float FRAME_LEG_RATIO = 0.1093f;  // 118 / 1080（每个角的臂长）
    private static final float FRAME_W_RATIO = 0.0041f;    // 4.4 / 1080
    private static final float ORBIT_R_RATIO = 0.2222f;    // 240 / 1080
    private static final float ORBIT_W_RATIO = 0.0024f;    // 2.6 / 1080
    private static final float KNOB_R_RATIO = 0.0050f;     // 5.4 / 1080
    private static final float GLOW_R_RATIO = 0.5741f;     // 620 / 1080
    private static final float WARM_X_RATIO = 0.815f;      // 880 / 1080
    private static final float WARM_Y_RATIO = 0.130f;      // 250 / 1920（相对高度）
    private static final float WARM_R_RATIO = 0.519f;      // 560 / 1080
    private static final float DOT_STEP_RATIO = 0.0407f;   // 44 / 1080
    private static final float DOT_R_RATIO = 0.00125f;     // 1.35 / 1080
    private static final float SCAN_BAND_RATIO = 0.0778f;  // 84 / 1080（光片半高）
    private static final float SCAN_LINE_RATIO = 0.0024f;  // 2.6 / 1080
    private static final float HALO_BLUR_RATIO = 0.10f;    // 模糊半径 ÷ 图标边长
    private static final float HALO_PAD_RATIO = 0.25f;     // 位图留边 ÷ 图标边长
    private static final float HALO_CORNER_RATIO = 0.215f;// 圆角 ÷ 图标边长
    private static final float KNOB_ALPHA = 0.9f;          // 读数头浓淡
    private static final float ARC_HEAD_ALPHA = 0.6f;      // 轨道弧头部浓淡
    private static final float SCAN_SLICE_FALLOFF = 1.5f;  // 光片纵向衰减指数

    private static final float ARC_SPAN_DEG = 140f;        // 弧长
    private static final int ARC_SEGMENTS = 72;            // 弧分几段做透明度渐变
    // 一圈 8 秒，逆时针。方向由 startOrbit() 的终点 -360 决定：
    // Android 角度正增量是顺时针，所以取负值才是逆时针。
    private static final long ORBIT_PERIOD_MS = 8000L;

    /* 扫描：先匀速扫过取景区，末尾留一段空档再重来。
       空档是必要的 —— 连续扫会像加载动画，有停顿才像「扫了一次」。
       SWEEP_FRACTION 之后不再绘制，所以 1.0 只是动画周期的终点。
       一个周期定在 2.4 秒，是为了让「第一遍扫完」落在启动层最短展示时长（1.8s）附近：
       晚 240ms 起步 + 1584ms 扫完 ≈ 1.8s，用户至少能看到完整的一次。 */
    private static final long SCAN_PERIOD_MS = 2400L;
    private static final float SWEEP_FRACTION = 0.66f;
    private static final int BAND_SLICES = 12;

    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint warmPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotPaint = new Paint();
    private final Paint framePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arcPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint knobPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint haloPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint iconPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint scanPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path framePath = new Path();
    private final RectF tmp = new RectF();
    private final RectF full = new RectF();

    private Bitmap icon;
    private Bitmap dots;
    private Bitmap halo;
    private int haloBlur;
    private int haloPad;
    private ValueAnimator orbitAnim;
    private ValueAnimator scanAnim;

    private float orbitDeg;
    private float scanT = 1f;   // 1 = 周期末尾（= 不绘制）
    private float reveal;

    public SplashView(Context context) {
        super(context);
        init();
    }

    public SplashView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    public SplashView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init();
    }

    /**
     * 颜色不再写死在 Java 里：改成读 color 资源，深色/浅色由 res/values[-night]/colors.xml
     * 决定。启动层那 1.8 秒是网页还没画出来的空档，如果它始终是深色，
     * 浅色用户每次打开都会「先黑一下」——这正是当初做覆盖层要解决的问题。
     *
     * getColor 的资源解析跟着 Activity 的 Configuration 走：AppCompat 的 DayNight
     * 已经把 uiMode 切好了，所以 -night 会自动命中，不需要额外判断。
     */
    private void init() {
        bg = res(getContext(), R.color.splash_bg);
        brand = res(getContext(), R.color.splash_brand);
        warm = res(getContext(), R.color.splash_warm);
        glowCore = res(getContext(), R.color.splash_glow_core);
        glowMid = res(getContext(), R.color.splash_glow_mid);
        frameColor = res(getContext(), R.color.splash_frame);
        scanColor = res(getContext(), R.color.splash_scan);
        bandColor = res(getContext(), R.color.splash_band);
        haloColor = res(getContext(), R.color.splash_halo);
        dotColor = res(getContext(), R.color.splash_dot);

        setBackgroundColor(bg);
        icon = BitmapFactory.decodeResource(getResources(), R.drawable.ic_splash_logo);
        arcPaint.setStyle(Paint.Style.STROKE);
        arcPaint.setStrokeCap(Paint.Cap.ROUND);
        framePaint.setStyle(Paint.Style.STROKE);
        framePaint.setStrokeCap(Paint.Cap.ROUND);
        framePaint.setStrokeJoin(Paint.Join.ROUND);
        scanPaint.setStyle(Paint.Style.FILL);
    }

    @SuppressLint("Deprecated")
    private static int res(Context c, @ColorRes int id) {
        // Deprecated 版是刻意的：新版 getColor(int, Theme) 要求 API 23+，
        // 而 minSdk 更低。Resources 本身跟着 Configuration 走，结果一样。
        return c.getResources().getColor(id);
    }

    /** 取颜色的浓淡（alpha 通道，0..1）。色相用 {@link #rgbOf(int)}。 */
    private static float alphaOf(int color) {
        return Color.alpha(color) / 255f;
    }

    /** 取颜色的色相（去掉 alpha）。 */
    private static int rgbOf(int color) {
        return color & 0x00FFFFFF;
    }

    // ── 对外接口 ──────────────────────────────────────────────

    /** 入场淡入进度 0..1。0 时整页只剩背景色，不会出现「先亮一下再淡入」。 */
    public void setReveal(float value) {
        if (reveal == value) return;
        reveal = value;
        invalidate();
    }

    /** 开始轨道旋转与扫描。系统关掉动画时只画静态画面，不做无意义的 invalidate。 */
    public void startOrbit() {
        if (orbitAnim != null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ValueAnimator.areAnimatorsEnabled()) return;

        // 负角速度 = 逆时针（Android 的世界里角度增大是顺时针）
        orbitAnim = ValueAnimator.ofFloat(0f, -360f);
        orbitAnim.setDuration(ORBIT_PERIOD_MS);
        orbitAnim.setRepeatCount(ValueAnimator.INFINITE);
        orbitAnim.setInterpolator(new LinearInterpolator());
        orbitAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                orbitDeg = (float) a.getAnimatedValue();
                invalidate();
            }
        });
        orbitAnim.start();

        // 扫描晚 240ms 起步：和图标淡入错开，观感是「先看到，再开始认」
        scanAnim = ValueAnimator.ofFloat(0f, 1f);
        scanAnim.setDuration(SCAN_PERIOD_MS);
        scanAnim.setStartDelay(240);
        scanAnim.setRepeatCount(ValueAnimator.INFINITE);
        scanAnim.setInterpolator(new LinearInterpolator());
        scanAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                scanT = (float) a.getAnimatedValue();
                invalidate();
            }
        });
        scanAnim.start();
    }

    public void stopOrbit() {
        if (orbitAnim != null) {
            orbitAnim.cancel();
            orbitAnim = null;
        }
        if (scanAnim != null) {
            scanAnim.cancel();
            scanAnim = null;
        }
    }

    // ── 尺寸相关 ──────────────────────────────────────────────

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w <= 0 || h <= 0) return;

        float cx = w / 2f;
        float cy = h * ICON_CY_RATIO;
        float glowR = w * GLOW_R_RATIO;

        // 品牌径向光晕：浓淡来自 colors.xml（深浅两版不一样）
        glowPaint.setShader(new RadialGradient(
                cx, cy, glowR,
                new int[]{glowCore, glowMid, rgbOf(glowMid)},
                new float[]{0f, 0.38f, 1f},
                Shader.TileMode.CLAMP));

        // 暖光：右上角一团很淡的琥珀色。它不做任何「功能表达」，
        // 只负责把纯绿的科技感往回拉一点，让画面像早晨而不是像机房。
        warmPaint.setShader(new RadialGradient(
                w * WARM_X_RATIO, h * WARM_Y_RATIO, w * WARM_R_RATIO,
                new int[]{warm, rgbOf(warm)},
                new float[]{0f, 1f},
                Shader.TileMode.CLAMP));

        buildDots(w, h, cx, cy, glowR);
        buildHalo(w * ICON_W_RATIO);
        buildFrame(cx, cy, w * FRAME_HALF_RATIO,
                w * FRAME_R_RATIO, w * FRAME_LEG_RATIO, w * FRAME_W_RATIO);
        buildScanShader(w, cx);
        full.set(0, 0, w, h);
    }

    /**
     * 取景框：四条 L 形角标。
     *
     * 只画角不画整框是刻意的 —— 完整方框在这套配色里会被读成「图片占位符」，
     * 而缺角的框才是「正在取景」。圆角必须和图标自身的圆角方向一致（向内收）。
     */
    private void buildFrame(float cx, float cy, float half, float r, float leg, float stroke) {
        float x0 = cx - half, x1 = cx + half;
        float y0 = cy - half, y1 = cy + half;
        framePath.reset();

        framePath.moveTo(x0, y0 + leg);
        framePath.lineTo(x0, y0 + r);
        framePath.quadTo(x0, y0, x0 + r, y0);
        framePath.lineTo(x0 + leg, y0);

        framePath.moveTo(x1 - leg, y0);
        framePath.lineTo(x1 - r, y0);
        framePath.quadTo(x1, y0, x1, y0 + r);
        framePath.lineTo(x1, y0 + leg);

        framePath.moveTo(x1, y1 - leg);
        framePath.lineTo(x1, y1 - r);
        framePath.quadTo(x1, y1, x1 - r, y1);
        framePath.lineTo(x1 - leg, y1);

        framePath.moveTo(x0 + leg, y1);
        framePath.lineTo(x0 + r, y1);
        framePath.quadTo(x0, y1, x0, y1 - r);
        framePath.lineTo(x0, y1 - leg);

        framePaint.setStrokeWidth(stroke);
        framePaint.setColor(frameColor);   // 浓淡在颜色自己的 alpha 里
    }

    /**
     * 扫描光片的横向羽化。
     *
     * 光片是横贯取景框的一条带子，如果直接画矩形，左右两条边会是硬切的直线；
     * 而 Canvas 没有 SVG 那种 mask。解法是让「颜色」本身带横向渐变
     * （中段实、两端透明），再用 Paint 的 alpha 控制纵向强度 ——
     * 这样一张 shader 同时负责羽化和上色，不需要离屏图层。
     */
    private void buildScanShader(float w, float cx) {
        float half = w * FRAME_HALF_RATIO;
        scanPaint.setShader(new LinearGradient(
                cx - half, 0f, cx + half, 0f,
                new int[]{argb(0f, brand), argb(1f, brand), argb(1f, brand), argb(0f, brand)},
                new float[]{0f, 0.16f, 0.84f, 1f},
                Shader.TileMode.CLAMP));
    }

    /**
     * 预渲染图标的外发光。
     *
     * 必须放在**离屏软件画布**上做：BlurMaskFilter 和 setShadowLayer 在硬件加速下
     * 都不生效，早期版本用「多层实心圆角矩形叠加」去凑，结果每层的边界都露了出来，
     * 图标周围是一圈看得见棱角的方形光带。
     *
     * 这里生成一次、之后每帧只是一次 drawBitmap —— 动画不会反复付模糊的代价。
     */
    private void buildHalo(float iconSize) {
        if (halo != null && !halo.isRecycled()) halo.recycle();

        haloBlur = Math.max(1, Math.round(iconSize * HALO_BLUR_RATIO));
        // 留边必须大于模糊半径：BlurMaskFilter 的衰减尾巴大约扩散到 2~3 倍半径，
        // 位图恰好卡在半径上时，尾巴会被边界切断，看上去就是一圈直边。
        haloPad = Math.max(haloBlur + 1, Math.round(iconSize * HALO_PAD_RATIO));
        int size = Math.round(iconSize) + haloPad * 2;
        halo = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);

        Canvas c = new Canvas(halo);   // 绑定 Bitmap 的 Canvas 是软件实现，模糊才会生效
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        // 这里用不透明的品牌色画：BlurMaskFilter 作用在 alpha 上，
        // 颜色本身带不带 alpha 会影响模糊结果的浓淡，不好预测。
        // 浓淡统一在绘制时用 haloPaint.setAlpha 施加（见 drawIcon）。
        p.setColor(rgbOf(haloColor));
        p.setMaskFilter(new BlurMaskFilter(haloBlur, BlurMaskFilter.Blur.NORMAL));
        float r = iconSize * HALO_CORNER_RATIO;
        c.drawRoundRect(haloPad, haloPad, haloPad + iconSize, haloPad + iconSize, r, r, p);
    }

    /**
     * 点阵按 1/2 分辨率缓存：全分辨率在 1440×3200 的机器上是 18MB，
     * 减半后 4.5MB，而点本身只有 1px 上下，放大回去看不出差别。
     */
    private void buildDots(int w, int h, float cx, float cy, float radius) {
        if (dots != null && !dots.isRecycled()) dots.recycle();
        int bw = Math.max(1, w / 2);
        int bh = Math.max(1, h / 2);
        dots = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888);

        Canvas c = new Canvas(dots);
        dotPaint.setColor(dotColor);
        dotPaint.setStyle(Paint.Style.FILL);

        float step = w * DOT_STEP_RATIO * 0.5f;
        float r = Math.max(0.6f, w * DOT_R_RATIO * 0.5f);
        float hx = cx * 0.5f;
        float hy = cy * 0.5f;
        float hr = radius * 0.5f;
        float base = alphaOf(dotColor);

        for (float y = 0; y < bh; y += step) {
            for (float x = 0; x < bw; x += step) {
                double d = Math.hypot(x - hx, y - hy) / hr;
                if (d > 1d) continue;
                double fade = Math.pow(1d - d, 1.7d);
                dotPaint.setAlpha((int) (255 * base * fade));
                c.drawCircle(x, y, r, dotPaint);
            }
        }

        // 循环里把 alpha 逐点改写过，残留值会作用到 drawScene 里「整层位图」的绘制上，
        // 让整片点阵跟着最后一个点的浓淡一起变淡。这里复位成不透明。
        dotPaint.setAlpha(255);
    }

    // ── 绘制 ──────────────────────────────────────────────────

    @Override
    protected void onDraw(Canvas canvas) {
        // 底色由 setBackgroundColor 铺好，这里不再画矩形（一层多余的全屏填充）
        if (reveal <= 0f) return;

        if (reveal >= 1f) {
            drawScene(canvas);
        } else {
            int sc = canvas.saveLayerAlpha(0, 0, getWidth(), getHeight(), (int) (255 * reveal));
            drawScene(canvas);
            canvas.restoreToCount(sc);
        }
    }

    private void drawScene(Canvas canvas) {
        canvas.drawRect(full, glowPaint);                       // 品牌径向光晕
        canvas.drawRect(full, warmPaint);                       // 右上角暖光
        if (dots != null && !dots.isRecycled()) {
            canvas.drawBitmap(dots, null, full, dotPaint);        // 点阵
        }
        canvas.drawPath(framePath, framePaint);                  // 取景框四角
        drawOrbit(canvas);
        drawIcon(canvas);
        drawScan(canvas);                                       // 最后画：光片压在图标上
    }

    private void drawOrbit(Canvas canvas) {
        float w = getWidth();
        float cx = w / 2f;
        float cy = getHeight() * ICON_CY_RATIO;
        float r = w * ORBIT_R_RATIO;

        tmp.set(cx - r, cy - r, cx + r, cy + r);
        arcPaint.setStrokeWidth(w * ORBIT_W_RATIO);

        // 沿弧方向淡出：不这么做的话弧会像一根断掉的铁丝，两端一样重。
        // base 是「头」（最亮 + 小圆点），弧向角度增大方向延伸 = 顺时针侧。
        // 轨道逆时针转，顺时针侧正好是运动后方，所以尾巴拖在后面——方向反过来时
        // 只需改 startOrbit() 的角速度符号，这里不要跟着反。
        float base = -90f + orbitDeg;
        for (int i = 0; i < ARC_SEGMENTS; i++) {
            float t = i / (float) ARC_SEGMENTS;
            float a0 = base + t * ARC_SPAN_DEG;
            float a1 = base + Math.min(1f, (i + 1.7f) / ARC_SEGMENTS) * ARC_SPAN_DEG;
            arcPaint.setColor(argb((float) Math.pow(1f - t, 1.6d) * ARC_HEAD_ALPHA, brand));
            canvas.drawArc(tmp, a0, a1 - a0, false, arcPaint);
        }

        // 起点小圆点，与图标自带的那个小圆点同构，跟着弧一起转
        double rad = Math.toRadians(base);
        float kx = cx + (float) (r * Math.cos(rad));
        float ky = cy + (float) (r * Math.sin(rad));
        knobPaint.setColor(argb(KNOB_ALPHA, brand));
        canvas.drawCircle(kx, ky, w * KNOB_R_RATIO, knobPaint);
    }

    private void drawIcon(Canvas canvas) {
        if (icon == null || icon.isRecycled()) return;

        float w = getWidth();
        float cx = w / 2f;
        float cy = getHeight() * ICON_CY_RATIO;
        float s = w * ICON_W_RATIO;
        float left = cx - s / 2f;
        float top = cy - s / 2f;

        // 入场时轻微放大，落点更「稳」
        float scale = 0.94f + 0.06f * reveal;
        canvas.save();
        canvas.scale(scale, scale, cx, cy);

        // 预渲染的模糊光晕。放在图标下方，图标本体盖住中心，只留边缘辉光。
        if (halo != null && !halo.isRecycled()) {
            haloPaint.setAlpha((int) (255 * alphaOf(haloColor)));
            tmp.set(left - haloPad, top - haloPad, left + s + haloPad, top + s + haloPad);
            canvas.drawBitmap(halo, null, tmp, haloPaint);
        }

        tmp.set(left, top, left + s, top + s);
        canvas.drawBitmap(icon, null, tmp, iconPaint);
        canvas.restore();
    }

    /**
     * 扫描光带。
     *
     * 纵向强度用「一叠薄片」堆出来，而不是再叠一层纵向渐变：
     * 一张 shader 已经占满了横向羽化，Canvas 没法让两个方向同时渐变。
     * 12 片在最大浓淡下肉眼看不出台阶，代价只是 12 次 drawRect。
     *
     * 浓淡的分配：紧贴扫描线的那一片最亮，往上下两侧逐片变淡 ——
     * 光是从被摄物上扫过去的，读数头那条线才是焦点。
     */
    private void drawScan(Canvas canvas) {
        if (scanT > SWEEP_FRACTION) return;      // 空档：扫完就消失，不留一条常亮的线

        float w = getWidth();
        float h = getHeight();
        float cx = w / 2f;
        float cy = h * ICON_CY_RATIO;
        float half = w * FRAME_HALF_RATIO;
        float bandH = w * SCAN_BAND_RATIO;

        float u = scanT / SWEEP_FRACTION;
        float pad = w * 0.02f;                   // 进出边框都留一点，别从角上凭空出现
        float top = cy - half + pad;
        float bottom = cy + half - pad;
        float y = top + (bottom - top) * u;

        // 两端各淡入淡出一小段，避免光片突然亮起/突然消失
        float a = Math.min(1f, Math.min(u / 0.08f, (1f - u) / 0.10f));

        float slice = bandH / BAND_SLICES;
        float x0 = cx - half, x1 = cx + half;

        // 光片浓淡 = 峰值(colors.xml) × 扫描线浓淡(colors.xml)
        float peak = alphaOf(bandColor) * alphaOf(scanColor);

        for (int i = 0; i < BAND_SLICES; i++) {
            // i = 0 是紧贴扫描线的那一片，越往外越淡
            float k = (BAND_SLICES - i) / (float) BAND_SLICES;
            scanPaint.setAlpha((int) (255 * peak * a * (float) Math.pow(k, SCAN_SLICE_FALLOFF)));

            // 线上方那段：近边贴线，往上一层层变淡
            canvas.drawRect(x0, y - (i + 1) * slice, x1, y - i * slice, scanPaint);
            // 线下方那段：镜像
            canvas.drawRect(x0, y + i * slice, x1, y + (i + 1) * slice, scanPaint);
        }

        scanPaint.setAlpha((int) (255 * alphaOf(scanColor) * a));
        float lw = w * SCAN_LINE_RATIO;
        canvas.drawRect(x0, y - lw / 2f, x1, y + lw / 2f, scanPaint);
    }

    // ── 生命周期 ──────────────────────────────────────────────

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        stopOrbit();
    }

    private static int argb(float alpha, int rgb) {
        int a = (int) (Math.max(0f, Math.min(1f, alpha)) * 255f);
        return (rgb & 0x00FFFFFF) | (a << 24);
    }
}
