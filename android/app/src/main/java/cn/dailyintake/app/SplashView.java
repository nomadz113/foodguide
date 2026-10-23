package cn.dailyintake.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Build;
import android.util.AttributeSet;
import android.view.View;
import android.view.animation.LinearInterpolator;

/**
 * 启动屏主画面：背景光晕 + 点阵 + 环绕图标的轨道弧 + 图标本体。
 *
 * <h3>为什么图标也画在这里，而不是用 ImageView</h3>
 * 轨道必须绕图标中心转。如果图标是 ImageView、轨道是另一个 View，
 * 圆心就得靠布局算出来再同步过去 —— 一旦文字块的测量结果和预期差几像素，
 * 弧就会绕着一个偏心的点转。画在同一个 onDraw 里，两者共用一组 cx/cy，
 * 同心是结构上保证的，不依赖任何同步代码。
 *
 * <h3>为什么所有尺寸都是比例而不是 dp</h3>
 * 设计稿是 1080×1920，图标边长占屏宽 29.6%、轨道半径占 24.26%。
 * 换 dp 固定值后，360dp 窄屏和 432dp 宽屏上图标与轨道的松紧关系会变
 * （轨道是比例、图标是定值，两者比例就漂了）。统一按宽/高比例算，
 * 任何屏幕的视觉构成都和设计稿一致。
 *
 * <h3>点阵为什么要缓存成 Bitmap</h3>
 * 约 800 个点，每帧画一次在低端机上会让 12 秒一圈的旋转掉帧。
 * 点阵本身不参与动画，画一次缓存起来，之后每帧只是一次 drawBitmap。
 */
public class SplashView extends View {

    private static final int C_BG = 0xFF0B0E13;
    private static final int C_BRAND = 0xFF3DDC84;   // 取自 app 图标
    private static final int C_INK = 0xFFE9EEF6;

    /* 全部来自 1080×1920 设计稿的实测值，除高度项外都以「视图宽」为基准 */
    private static final float ICON_W_RATIO = 0.296f;     // 320 / 1080
    private static final float ICON_CY_RATIO = 0.4063f;   // 780 / 1920（相对高度）
    private static final float ORBIT_R_RATIO = 0.2426f;   // 262 / 1080
    private static final float GLOW_R_RATIO = 0.593f;     // 640 / 1080
    private static final float DOT_STEP_RATIO = 0.0407f;  // 44 / 1080
    private static final float DOT_R_RATIO = 0.0012f;     // 1.3 / 1080
    private static final float ARC_W_RATIO = 0.0021f;     // 2.2 / 1080
    private static final float KNOB_R_RATIO = 0.0042f;    // 4.5 / 1080
    private static final float HALO_BLUR_RATIO = 0.10f;   // 模糊半径 ÷ 图标边长
    private static final float HALO_PAD_RATIO = 0.25f;    // 位图留边 ÷ 图标边长
    private static final int HALO_ALPHA = 107;            // 0.42，同设计稿的 shadowColor

    private static final float ARC_SPAN_DEG = 140f;       // 弧长
    private static final int ARC_SEGMENTS = 72;           // 弧分几段做透明度渐变
    // 一圈 8 秒，逆时针。方向由 startOrbit() 的终点 -360 决定：
    // Android 角度正增量是顺时针，所以取负值才是逆时针。
    private static final long ORBIT_PERIOD_MS = 8000L;

    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotPaint = new Paint();
    private final Paint arcPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint knobPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint haloPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint iconPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final RectF tmp = new RectF();
    private final RectF full = new RectF();

    private Bitmap icon;
    private Bitmap dots;
    private Bitmap halo;
    private int haloBlur;
    private int haloPad;
    private ValueAnimator orbitAnim;

    private float orbitDeg;
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

    private void init() {
        setBackgroundColor(C_BG);
        icon = BitmapFactory.decodeResource(getResources(), R.drawable.ic_splash_logo);
        arcPaint.setStyle(Paint.Style.STROKE);
        arcPaint.setStrokeCap(Paint.Cap.ROUND);
    }

    // ── 对外接口 ──────────────────────────────────────────────

    /** 入场淡入进度 0..1。0 时整页只剩背景色，不会出现「先亮一下再淡入」。 */
    public void setReveal(float value) {
        if (reveal == value) return;
        reveal = value;
        invalidate();
    }

    /** 开始轨道旋转。系统关掉动画时只画静态弧，不做无意义的 invalidate。 */
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
    }

    public void stopOrbit() {
        if (orbitAnim == null) return;
        orbitAnim.cancel();
        orbitAnim = null;
    }

    // ── 尺寸相关 ──────────────────────────────────────────────

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w <= 0 || h <= 0) return;

        float cx = w / 2f;
        float cy = h * ICON_CY_RATIO;
        float glowR = w * GLOW_R_RATIO;

        glowPaint.setShader(new RadialGradient(
                cx, cy, glowR,
                new int[]{argb(0.15f, C_BRAND), argb(0.055f, C_BRAND), argb(0f, C_BRAND)},
                new float[]{0f, 0.38f, 1f},
                Shader.TileMode.CLAMP));

        buildDots(w, h, cx, cy, glowR);
        buildHalo(w * ICON_W_RATIO);
        full.set(0, 0, w, h);
    }

    /**
     * 预渲染图标的外发光。
     *
     * 必须放在**离屏软件画布**上做：BlurMaskFilter 和 setShadowLayer 在硬件加速下
     * 都不生效，早期版本用「多层实心圆角矩形叠加」去凑，结果每层的边界都露了出来，
     * 图标周围是一圈看得见棱角的方形光带。
     *
     * 这里生成一次、之后每帧只是一次 drawBitmap —— 旋转动画不会反复付模糊的代价。
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
        p.setColor(C_BRAND);
        p.setMaskFilter(new BlurMaskFilter(haloBlur, BlurMaskFilter.Blur.NORMAL));
        float r = iconSize * 0.215f;
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
        dotPaint.setColor(C_INK);
        dotPaint.setStyle(Paint.Style.FILL);

        float step = w * DOT_STEP_RATIO * 0.5f;
        float r = Math.max(0.6f, w * DOT_R_RATIO * 0.5f);
        float hx = cx * 0.5f;
        float hy = cy * 0.5f;
        float hr = radius * 0.5f;

        for (float y = 0; y < bh; y += step) {
            for (float x = 0; x < bw; x += step) {
                double d = Math.hypot(x - hx, y - hy) / hr;
                if (d > 1d) continue;
                double fade = Math.pow(1d - d, 1.7d);
                dotPaint.setAlpha((int) (255 * 0.028d * fade));
                c.drawCircle(x, y, r, dotPaint);
            }
        }
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
        if (dots != null && !dots.isRecycled()) {
            canvas.drawBitmap(dots, null, full, dotPaint);        // 点阵
        }
        drawOrbit(canvas);
        drawIcon(canvas);
    }

    private void drawOrbit(Canvas canvas) {
        float w = getWidth();
        float cx = w / 2f;
        float cy = getHeight() * ICON_CY_RATIO;
        float r = w * ORBIT_R_RATIO;

        tmp.set(cx - r, cy - r, cx + r, cy + r);
        arcPaint.setStrokeWidth(w * ARC_W_RATIO);

        // 沿弧方向淡出：不这么做的话弧会像一根断掉的铁丝，两端一样重。
        // base 是「头」（最亮 + 小圆点），弧向角度增大方向延伸 = 顺时针侧。
        // 轨道逆时针转，顺时针侧正好是运动后方，所以尾巴拖在后面——方向反过来时
        // 只需改 startOrbit() 的角速度符号，这里不要跟着反。
        float base = -90f + orbitDeg;
        for (int i = 0; i < ARC_SEGMENTS; i++) {
            float t = i / (float) ARC_SEGMENTS;
            float a0 = base + t * ARC_SPAN_DEG;
            float a1 = base + Math.min(1f, (i + 1.7f) / ARC_SEGMENTS) * ARC_SPAN_DEG;
            arcPaint.setColor(argb((float) Math.pow(1f - t, 1.6d) * 0.6f, C_BRAND));
            canvas.drawArc(tmp, a0, a1 - a0, false, arcPaint);
        }

        // 起点小圆点，与图标自带的那个小圆点同构，跟着弧一起转
        double rad = Math.toRadians(base);
        float kx = cx + (float) (r * Math.cos(rad));
        float ky = cy + (float) (r * Math.sin(rad));
        knobPaint.setColor(argb(0.9f, C_BRAND));
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
            haloPaint.setAlpha(HALO_ALPHA);
            tmp.set(left - haloPad, top - haloPad, left + s + haloPad, top + s + haloPad);
            canvas.drawBitmap(halo, null, tmp, haloPaint);
        }

        tmp.set(left, top, left + s, top + s);
        canvas.drawBitmap(icon, null, tmp, iconPaint);
        canvas.restore();
    }

    // ── 生命周期 ──────────────────────────────────────────────

    @Override
    protected void onDetachedFromWindow() {
        stopOrbit();
        super.onDetachedFromWindow();
    }

    // ── 工具 ──────────────────────────────────────────────────

    private static int argb(float alpha, int rgb) {
        int a = (int) (Math.max(0f, Math.min(1f, alpha)) * 255f);
        return (rgb & 0x00FFFFFF) | (a << 24);
    }
}
