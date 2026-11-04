# 好好吃饭 · FoodGuide

> 拍照记录饮食，AI 识别食物并估算份量，自动换算 19 项营养素，与你自己的目标做对比。
> 零后端、纯本地存储 —— 所有数据留在设备上，只有识别这一步会联网。

安卓手机优先，支持安装为 PWA，另有 Capacitor 打包的原生壳。

## 功能

- **拍照录入**：拍一张餐盘照片，识别食物种类与份量，自动拆分烹饪用油和糖
- **19 项营养素**：热量、蛋白质、脂肪、碳水、膳食纤维、糖、钠、钾、钙、铁、锌、维 A/C/D/E/B1/B2/烟酸/叶酸等
- **个性化目标**：按 BMR（Mifflin-St Jeor，有体脂率时用 Katch-McArdle）+ 活动量推导每日目标，带热量下限保护
- **多周期统计**：日 / 周 / 月 / 季视图，达标率按「有记录的天」计算
- **体重趋势**：原始数据点 + 7 日均线，理论体重按累计热量缺口折算
- **自然语言记录**：直接说「中午吃了碗牛肉面」，走意图解析 → 实体解析 → 确认写入三步
- **AI 建议**：数字全部由代码计算，模型只负责叙述，输出里出现未授权的数字整条丢弃
- **本地备份**：导出 / 导入 JSON，按业务键合并，幂等

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 7 |
| 路由 | HashRouter（适配离线 WebView） |
| 存储 | IndexedDB（Dexie 4） |
| 模型 | 阿里云百炼 `qwen3-vl-plus`（视觉识别）+ `qwen-plus`（文本） |
| 原生壳 | Capacitor 7（Android） |
| 样式 | 手写 CSS 变量，不依赖 Tailwind |

## 仓库结构

```
app/                 应用主体（代码、安卓工程、构建脚本都在这里）
  src/               业务内核与页面
  android/           Capacitor Android 工程
  tools/             构建、检查与截图脚本
  README.md          详细文档：功能说明、目录结构、设计取舍
```

**刻意不入库的内容**：API 密钥、APK 签名证书、内部设计文档、换机迁移脚本、本地工具链（JDK + Android SDK）。

这些只存在于开发机本地与离线备份中，因为本仓库是**公开**的。所以你会看到仓库只有 `app/` 一个目录 —— 这是设计，不是缺失。

## 本地开发

```bash
cd app
npm install
npm run dev
```

识别功能需要一把百炼 API Key，可以放在环境变量里，也可以在 App 的「设置」页填写（加密后存进 IndexedDB，不经过任何自有服务器）。

其他命令：

```bash
npm run build      # tsc --noEmit && vite build
npm run typecheck  # 只做类型检查
npm test           # vitest
```

## 打包 Android

```bash
cd app
npm run build
node tools/apk-config.mjs offline     # 或 wb（加载线上托管页面）
npx cap copy android
cd android && ./gradlew assembleDebug
```

`tools/apk-config.mjs` 负责切换离线（内嵌 dist）/ 在线（加载远端）两种运行模式，顺序不能颠倒。安装包不入库。

## 设计取舍

- **快照式存储**：每条餐食记录自带当时的营养数值，改食物库不会篡改历史
- **数字由代码算，模型只叙述**：避免模型编造热量与克数
- **`null` 表示未知，不等于 0**：缺失数据不计入达标分母，覆盖率低时显示「—」
- **AI 写库必须一次人工点击**：识别结果先进待确认区，确认后才落库
- **不做生熟折算**：已知会低估，如实保留并在界面标注来源

## 许可

个人项目，未附开源许可。如需复用请先联系作者。
