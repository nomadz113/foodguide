package cn.dailyintake.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * 相机可用性自检。
 *
 * WebView 里 <input capture> 走的是 Intent(ACTION_IMAGE_CAPTURE)，能不能起来完全取决于
 * PackageManager 能不能解析到这个 Intent。系统一旦返回 null，Capacitor 会静默回退到
 * 文件选择器（只剩相册），前端拿不到任何信号 —— 只能靠这里问原生。
 *
 * 注意：queryIntentActivities 同样受 Android 11 包可见性限制，所以结果只有在
 * AndroidManifest 声明了 <queries> 之后才是可信的（本项目的清单已声明）。
 */
@CapacitorPlugin(name = "CameraProbe")
public class CameraProbePlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();

        List<ResolveInfo> handlers = query(MediaStore.ACTION_IMAGE_CAPTURE);
        ret.put("canCapture", !handlers.isEmpty());
        ret.put("cameraApps", handlers.size());
        ret.put("handlers", joinPackages(handlers));

        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("manufacturer", Build.MANUFACTURER);

        call.resolve(ret);
    }

    private List<ResolveInfo> query(String action) {
        Intent intent = new Intent(action);
        PackageManager pm = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY));
        }
        return pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
    }

    private String joinPackages(List<ResolveInfo> list) {
        StringBuilder sb = new StringBuilder();
        for (ResolveInfo info : list) {
            if (info.activityInfo == null) continue;
            if (sb.length() > 0) sb.append(", ");
            sb.append(info.activityInfo.packageName);
        }
        return sb.toString();
    }
}
