package cn.dailyintake.app;

import android.animation.ValueAnimator;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;

import androidx.appcompat.app.AppCompatActivity;

/**
 * 启动屏：显示约 2 秒后进入 MainActivity。
 *
 * 三个刻意处理的细节，都不是可选的：
 *
 * 1) **从后台切回来不能又弹一次启动屏。** 桌面图标每次点击都会启动 LAUNCHER activity，
 *    若不加判断，从最近任务切回来还得再等 2 秒。用 isTaskRoot() 判断：不是任务栈根
 *    说明栈顶已经是 MainActivity（用户只是切回前台），直接结束自己。
 * 2) **启动 intent 的 data / extras 要原样转给 MainActivity。** 现在桌面图标不带东西，
 *    但将来接通知或深链时，丢在这里会造成「点通知进错页面」这种难查的 bug。
 * 3) **去掉转场动画。** 两个 Activity 之间默认的淡入淡出会让这 2 秒末尾闪一下。
 *
 * 另外点一下屏幕可以跳过：愿意等的人不用等，赶时间的人也不用等。
 *
 * ── 关于入场动画 ──
 * 图标与轨道的淡入、缩放由 {@link SplashView} 承担，文字块的淡入在这里做。
 * 动画全部尊重系统的「移除动画」开关（ValueAnimator.areAnimatorsEnabled）：
 * 用户开了无障碍偏好就直接显示终态，而不是硬播一遍。
 */
public class SplashActivity extends AppCompatActivity {

    private static final long SHOW_MS = 2000;

    /** 文字块顶端对应设计稿 1029/1920 —— 图标下沿再留 80px */
    private static final float TEXT_TOP_RATIO = 0.536f;
    private static final long ART_FADE_MS = 520;
    private static final long TEXT_MS = 380;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean entered = false;

    private SplashView art;
    private View textBlock;

    private final Runnable next = new Runnable() {
        @Override
        public void run() {
            enter();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (!isTaskRoot()) {
            finish();
            return;
        }

        setContentView(R.layout.activity_splash);
        art = findViewById(R.id.splashArt);
        textBlock = findViewById(R.id.splashText);

        findViewById(android.R.id.content).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                handler.removeCallbacks(next);
                enter();
            }
        });

        // 文字位置依赖实测高度（16:9 与 20:9 的屏高差很多），测量完再定位，
        // 定位完再开始动画 —— 否则文字会在动画中途跳一下。
        art.post(new Runnable() {
            @Override
            public void run() {
                if (isFinishing()) return;
                placeText();
                playEntrance();
            }
        });

        handler.postDelayed(next, SHOW_MS);
    }

    private void placeText() {
        ViewGroup.LayoutParams raw = textBlock.getLayoutParams();
        if (!(raw instanceof FrameLayout.LayoutParams)) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) raw;
        lp.topMargin = Math.round(art.getHeight() * TEXT_TOP_RATIO);
        textBlock.setLayoutParams(lp);
    }

    private void playEntrance() {
        if (!animatorsEnabled()) {
            art.setReveal(1f);
            textBlock.setAlpha(1f);
            return;
        }

        ValueAnimator fade = ValueAnimator.ofFloat(0f, 1f);
        fade.setDuration(ART_FADE_MS);
        fade.setInterpolator(new DecelerateInterpolator(1.6f));
        fade.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                art.setReveal((float) a.getAnimatedValue());
            }
        });
        fade.start();
        art.startOrbit();

        textBlock.setAlpha(1f);
        rise(findViewById(R.id.splashSlogan), 140);
        rise(findViewById(R.id.splashBrand), 220);
    }

    /** 单行文字：淡入 + 上移 10dp。方向朝上，视觉上是「浮起来」而不是「落下来」。 */
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

    private static boolean animatorsEnabled() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled();
    }

    private void enter() {
        if (entered) return; // 定时器和点击可能同时触发
        entered = true;

        Intent intent = new Intent(this, MainActivity.class);
        Intent from = getIntent();
        if (from != null) {
            intent.setData(from.getData());
            if (from.getExtras() != null) intent.putExtras(from.getExtras());
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        startActivity(intent);
        overridePendingTransition(0, 0);
        finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(next);
        if (art != null) art.stopOrbit();
        super.onDestroy();
    }
}
