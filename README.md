# 每日摄入 · FoodGuide

拍照记录饮食，AI 识别食物并估算份量，自动换算 19 项营养素，与你自己的目标做对比。
零后端、纯本地存储 —— 所有数据留在设备上，只有识别这一步会联网。

安卓手机优先（支持安装为 PWA，另有 Capacitor 打包的原生壳）。

## 功能

- **拍照录入**：拍一张餐盘照片，识别食物种类与份量，自动拆分烹饪用油和糖
- **19 项营养素**：热量、蛋白质、脂肪、碳水、膳食纤维、糖、钠、钾、钙、铁、锌、维 A/C/D/E/B1/B2/烟酸/叶酸等
- **个性化目标**：按 BMR（Mifflin-St Jeor，有体脂率时用 Katch-McArdle）+ 活动量算每日目标，设置热量下限保护
- **多周期统计**：日 / 周 / 月 / 季 视图，达标率按「有记录的天」计算
- **体重趋势**：原始数据点 + 7 日均线，理论体重按累计热量缺口折算
- **自然语言记录**：直接说「中午吃了碗牛肉面」，走意图解析 → 实体解析 → 确认写入三步
- **AI 建议**：数字全部由代码计算，模型只负责叙述，输出里出现未授权的数字整条丢弃
- **本地备份**：导出 / 导入 JSON，按业务键合并，幂等

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 7 |
| 路由 | HashRouter（适配离线 WebView） |
| 存储 | IndexedDB（Dexie 4，九张表） |
| 模型 | 阿里云百炼 `qwen3-vl-plus`（视觉识别）+ `qwen-plus`（文本） |
| 原生壳 | Capacitor 7（Android） |
| 样式 | 手写 CSS 变量（不依赖 Tailwind） |

## 快速开始

```bash
npm install
cp .env.local.example .env.local   # 若无示例文件，按下方手工创建
npm run dev
```

`.env.local` 内容（仅本地开发用，已被 `.gitignore` 忽略）：

```
DASHSCOPE_API_KEY=sk-你的密钥
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VISION_MODEL=qwen3-vl-plus
```

密钥也可以在 App 内「设置」页填写，加密后存进 IndexedDB，不经过任何自有服务器。

其他命令：

```bash
npm run build      # tsc --noEmit && vite build
npm run typecheck  # 只做类型检查
npm test           # vitest
```

## 目录结构

```
src/
  core/            业务内核（不依赖 React）
    ai/            唯一网络出口，模型调用
    db/            Dexie 表结构与 DAO
    nutrition/     营养素计算、目标推导
    food/          食物库与模糊匹配
    meal/          餐次与条目
    intent/        自然语言 → 意图
    portion/       份量估算
    report/        周期统计
    advice/        建议生成
    backup/        导入导出
  pages/           路由页面
  ui/              通用组件
  native/          原生桥接（返回键等）
  store/           全局状态
public/            manifest、Service Worker、图标
android/           Capacitor Android 工程
```

## 打包 Android

```bash
npm run build
node tools/apk-config.mjs offline     # 或 online / wb
npx cap copy android
cd android && ./gradlew assembleRelease
```

`tools/apk-config.mjs` 负责切换离线（内嵌 dist）/ 在线（加载远端）两种运行模式，
打包前必须按顺序执行；直接 `cap sync` 会覆盖配置。安装包不入库，走 Releases。

## 设计取舍

- **快照式存储**：每条餐食记录自带当时的营养数值，改食物库不会篡改历史记录
- **数字由代码算，模型只叙述**：避免模型编造热量与克数
- **`null` 表示未知，不等于 0**：缺失数据不计入达标分母，覆盖率低于阈值时显示「—」
- **AI 写库必须一次人工点击**：识别结果先进待确认区，确认后才落库
- **不做生熟折算**：已知会低估，如实保留并在界面标注来源

## 许可

个人项目，未附开源许可。如需复用请先联系作者。
