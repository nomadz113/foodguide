package cn.dailyintake.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.View;

/**
 * 启动屏的心电分隔线：一根横贯全宽的心电图，中间起一个 QRS 波。
 *
 * <h3>为什么单独一个 View，而不是画进 SplashView</h3>
 * 它要落在「能力图标行」和底部说明之间，而这个位置由文字块的测量结果决定
 * （字号、字体缩放、系统语言都会让它变）。画在 SplashView 里就得用一个写死的屏高比例，
 * 一旦文字块比预期高，线就会压到字上。放在 LinearLayout 里让它自己占位，
 * 上下间距永远由布局保证，和画得像不像无关。
 *
 * <h3>为什么是心电而不是一根普通分割线</h3>
 * 分割线只解决版式；心电同时说了「健康 / 健身 / 有生命」，
 * 而这正是这一屏除「记录」之外要表达的东西。波形只在中间起一次，
 * 不铺满 —— 铺满会变成装饰纹样，反而抢字。
 */
public class SplashEcgView extends View {

    /** 波峰占视图高度的一半×0.68，留出上下余量，避免粗屏上被裁 */
    private static final float AMP_RATIO = 0.34f;
    private static final float STROKE_DP = 0.9f;

    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();

    public SplashEcgView(Context context) {
        super(context);
        init();
    }

    public SplashEcgView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    public SplashEcgView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init();
    }

    private void init() {
        linePaint.setStyle(Paint.Style.STROKE);
        linePaint.setStrokeWidth(STROKE_DP * getResources().getDisplayMetrics().density);
        linePaint.setStrokeCap(Paint.Cap.ROUND);
        linePaint.setStrokeJoin(Paint.Join.ROUND);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w <= 0 || h <= 0) return;

        float y = h / 2f;
        float a = h * AMP_RATIO;

        path.reset();
        path.moveTo(0f, y);
        path.lineTo(w * 0.3553f, y);
        path.lineTo(w * 0.3745f, y);
        path.lineTo(w * 0.3872f, y - a * 0.33f);
        path.lineTo(w * 0.4021f, y + a * 0.60f);
        path.lineTo(w * 0.4191f, y - a);
        path.lineTo(w * 0.4362f, y + a * 0.45f);
        path.lineTo(w * 0.4511f, y);
        path.lineTo(w, y);

        // 两端淡出：这根线的身份是「分隔」，不能有起止点
        int brand = getResources().getColor(R.color.splash_brand);
        int clear = brand & 0x00FFFFFF;
        linePaint.setShader(new LinearGradient(0f, 0f, w, 0f,
                new int[]{
                        withAlpha(clear, 0.06f),
                        withAlpha(brand, 0.30f),
                        withAlpha(brand, 0.62f),
                        withAlpha(brand, 0.30f),
                        withAlpha(clear, 0.06f)},
                new float[]{0f, 0.32f, 0.50f, 0.68f, 1f},
                Shader.TileMode.CLAMP));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawPath(path, linePaint);
    }

    private static int withAlpha(int rgb, float alpha) {
        int a = (int) (Math.max(0f, Math.min(1f, alpha)) * 255f);
        return (rgb & 0x00FFFFFF) | (a << 24);
    }
}
