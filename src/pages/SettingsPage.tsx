import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { allFoods, patchSettings } from '../core/db/repo';
import { useAppData } from '../store/AppData';
import { db } from '../core/db/schema';
import { testConnection } from '../core/ai/client';
import { deobfuscate, maskKey, obfuscate } from '../core/ai/keyStore';
import { AI_ERROR_TEXT, AiError } from '../core/ai/types';
import {
  applyBackup, backupFileName, buildBackup, markExported, serializeBackup,
  type ImportSummary,
} from '../core/backup/backup';
import { pickTextFile, saveTextFile } from '../core/backup/file';
import { parseBackup, summarizeBackup, type BackupFile, type BackupSummary } from '../core/backup/types';

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/**
 * 键盘让位的读数（只在原生包里有）。
 *
 * 为什么要有：让位失败的根因在原生层，而那层前端看不见。
 * 没有读数就只能靠「还是盖住了」这种描述反推，一次要猜五六个环节。
 * 有了这四个数，一眼能分出是「原生没读到键盘」还是「读到了但壳没跟着缩」。
 */
function ImeDiag() {
  const [info, setInfo] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const read = () => {
      const raw = (window as unknown as { __imeInfo?: string }).__imeInfo;
      if (!raw) return;
      try { setInfo(JSON.parse(raw) as Record<string, number>); } catch { /* 忽略 */ }
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  if (!info) return null;
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="title row"><span>让位读数 · 键盘 / 系统栏</span></div>
      <div className="krow">
        <span className="k">原生扣掉</span>
        <span className="v">{info.kb}<small>px（insets {info.insets} / 可见区 {info.layout}）</small></span>
      </div>
      <div className="krow">
        <span className="k">视口</span>
        <span className="v" style={{ fontSize: 11 }}>
          inner {info.inner} / visual {info.vv} / 基线 {info.base}
        </span>
      </div>
      <div className="krow">
        <span className="k">系统栏</span>
        <span className="v" style={{ fontSize: 11 }}>
          上 {info.navT} / 下 {info.navB} px · 画到栏下 {info.behind ? '是' : '否'}
        </span>
      </div>
      <div className="hint" style={{ textAlign: 'left', marginTop: 6 }}>
        弹过一次键盘再回来看这行。都是 0 说明原生也没读到键盘；有数字却还盖住，就是壳没跟着缩。
        「系统栏 · 画到栏下=否」表示系统已经自己让过位，原生不再加边；=是 且上/下有数字，就是原生让开的那一段。
      </div>
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relTime(ts: number | null): string {
  if (!ts) return '从未备份';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

function importText(r: ImportSummary): string {
  const c = r.counts;
  const total = c.meals.added + c.foods.added + c.weights.added + c.chat.added
    + c.goals.added + c.advices.added + c.photos;
  if (total === 0 && !r.profileUpdated && !r.keyRestored && r.settingsChanged === 0) {
    return '这个文件里的内容本机已经有了，没有任何变化。';
  }
  const lines = [
    `餐次：新增 ${c.meals.added} 条，更新 ${c.meals.updated} 条`,
    `自定义食物：新增 ${c.foods.added} 条，更新 ${c.foods.updated} 条`,
    `体重：新增 ${c.weights.added} 条，更新 ${c.weights.updated} 条`,
  ];
  if (c.goals.added) lines.push(`目标快照：新增 ${c.goals.added} 条`);
  if (c.advices.added) lines.push(`每日建议：新增 ${c.advices.added} 条`);
  if (c.chat.added) lines.push(`聊天记录：新增 ${c.chat.added} 条`);
  if (c.photos) lines.push(`照片：${c.photos} 张`);
  if (r.profileUpdated) lines.push('档案：已换成备份里较新的那份，目标已重算');
  if (r.keyRestored) lines.push('API Key：已从备份恢复');
  return `导入完成：\n${lines.join('\n')}`;
}

export function SettingsPage() {
  const nav = useNavigate();
  const { settings, applySettings } = useAppData();
  const foods = useLiveQuery(() => allFoods(), []);
  const mealCount = useLiveQuery(() => db.meals.count(), []);
  const weightCount = useLiveQuery(() => db.weights.count(), []);

  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ── 备份 ──
  const [withKey, setWithKey] = useState(false);
  const [withPhotos, setWithPhotos] = useState(false);
  const [bBusy, setBBusy] = useState(false);
  const [bMsg, setBMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file: BackupFile; sum: BackupSummary } | null>(null);

  async function doExport() {
    setBBusy(true);
    setBMsg(null);
    try {
      const file = await buildBackup({ photos: withPhotos, apiKey: withKey });
      const { how, detail } = await saveTextFile(backupFileName(), serializeBackup(file));
      await markExported();
      const s = (await db.settings.get('app'));
      if (s) applySettings(s);
      setBMsg(
        how === 'shared' ? '已生成备份文件，请在弹出的面板里选择保存到哪里（微信/网盘/手机存储都行）。'
          : how === 'downloaded' ? `已导出 ${backupFileName()}`
            : how === 'canceled' ? '已取消，备份文件没有保存。'
              : `导出失败${detail ? `（${detail.slice(0, 60)}）` : ''}。可以试试用手机浏览器打开同一个网址再导出一次。`,
      );
    } catch (e) {
      setBMsg(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBBusy(false);
    }
  }

  async function doPick() {
    setBMsg(null);
    const text = await pickTextFile();
    if (!text) return;
    const r = parseBackup(text);
    if (!r.ok) {
      setBMsg(`无法导入：${r.error}`);
      setPreview(null);
      return;
    }
    setPreview({ file: r.backup, sum: summarizeBackup(r.backup) });
  }

  async function doImport() {
    if (!preview) return;
    setBBusy(true);
    setBMsg(null);
    try {
      const r = await applyBackup(preview.file);
      setPreview(null);
      window.alert(`${importText(r)}\n\n点确定后刷新页面，数据就会显示出来。`);
      window.location.reload();
    } catch (e) {
      setBMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      setBBusy(false);
    }
  }

  async function saveKey() {
    const k = keyInput.trim();
    if (!k) return;
    setBusy(true);
    setMsg(null);
    try {
      const next = await patchSettings({ apiKeyCipher: obfuscate(k) });
      applySettings(next);
      setKeyInput('');
      setMsg('已保存，点「测试连接」验证一下。');
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    const next = await patchSettings({ apiKeyCipher: null });
    applySettings(next);
    setMsg('已清除，识别功能将不可用。');
  }

  async function ping() {
    setBusy(true);
    setMsg(null);
    try {
      const reply = await testConnection({
        mode: 'direct',
        apiKey: deobfuscate(settings.apiKeyCipher),
        baseUrl: DASHSCOPE_BASE,
        model: settings.visionModel,
      });
      setMsg(`连接正常（模型回复「${reply}」）`);
    } catch (e) {
      setMsg(e instanceof AiError ? `失败：${AI_ERROR_TEXT[e.code]}` : '失败：未知错误');
    } finally {
      setBusy(false);
    }
  }

  async function setDayStart(h: number) {
    const next = await patchSettings({ dayStartHour: h });
    applySettings(next);
  }

  async function wipe() {
    if (!window.confirm('清空全部本地数据？记录、自定义食物、档案都会删除，且无法恢复。')) return;
    await db.delete();
    window.location.reload();
  }

  return (
    <>
      <div className="hdr">
        <div>
          <h1>设置</h1>
          <div className="sub">本机配置 · 不上传服务器</div>
        </div>
        <span className="pill">{foods?.length ?? 0} 条食物</span>
      </div>

      <div className="main">
        <div className="flabel">一天的开始</div>
        <div className="seg">
          {[0, 4, 6].map((h) => (
            <button key={h} className={settings.dayStartHour === h ? 'on' : ''} onClick={() => void setDayStart(h)}>
              {h === 0 ? '0 点' : `凌晨 ${h} 点`}
            </button>
          ))}
        </div>
        <div className="hint" style={{ textAlign: 'left', marginTop: 7 }}>
          按凌晨 {settings.dayStartHour} 点切日。熬夜到 2 点吃的夜宵会算进前一天，不会被切开。
        </div>

        <div className="flabel">AI 识别</div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="krow">
            <span className="k">视觉模型</span>
            <span className="v" style={{ fontSize: 11 }}>{settings.visionModel}</span>
          </div>
          <div className="krow">
            <span className="k">API Key</span>
            <span className="v" style={{ fontSize: 11, color: settings.apiKeyCipher ? 'var(--green)' : 'var(--mute)' }}>
              {settings.apiKeyCipher ? maskKey(deobfuscate(settings.apiKeyCipher)) : '未配置'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <div className="field" style={{ flex: 1 }}>
            <span>粘贴百炼 API Key</span>
            <input
              type="password"
              value={keyInput}
              placeholder="sk-..."
              autoComplete="off"
              onChange={(e) => setKeyInput(e.target.value)}
            />
          </div>
          <button
            className="pill ok"
            style={{ width: 62, alignSelf: 'stretch' }}
            disabled={!keyInput.trim() || busy}
            onClick={() => void saveKey()}
          >
            保存
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="pill" style={{ flex: 1 }} disabled={!settings.apiKeyCipher || busy} onClick={() => void ping()}>
            {busy ? '测试中…' : '测试连接'}
          </button>
          {settings.apiKeyCipher && (
            <button className="pill bad" style={{ flex: 1 }} disabled={busy} onClick={() => void clearKey()}>
              清除 Key
            </button>
          )}
        </div>

        <div className="hint" style={{ textAlign: 'left', marginTop: 7 }}>
          {msg ?? 'Key 只存在本机浏览器（混淆存储，非加密）。要分享给别人请改用云函数代理，Key 进环境变量。'}
        </div>

        <div className="flabel">数据</div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="krow">
            <span className="k">食物库</span>
            <span className="v">{foods?.length ?? 0}<small>条</small></span>
          </div>
          <div className="krow">
            <span className="k">餐次</span>
            <span className="v">{mealCount ?? 0}<small>条</small></span>
          </div>
          <div className="krow">
            <span className="k">体重</span>
            <span className="v">{weightCount ?? 0}<small>条</small></span>
          </div>
          <div className="krow">
            <span className="k">存储</span>
            <span className="v" style={{ fontSize: 11, color: 'var(--dim)' }}>IndexedDB · 本机</span>
          </div>
          <div className="krow">
            <span className="k">种子版本</span>
            <span className="v">{settings.seedVersion}</span>
          </div>
        </div>

        <div className="flabel">备份</div>
        <div className="hint" style={{ textAlign: 'left', margin: '0 0 8px' }}>
          数据只存在这台设备的这个入口里 —— 换手机、换入口、清缓存都会读不到。
          导出一份文件就能搬走。上次备份：{relTime(settings.lastBackupAt)}。
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="pill" style={{ flex: 1 }} disabled={bBusy} onClick={() => void doExport()}>
            {bBusy ? '处理中…' : '导出备份'}
          </button>
          <button className="pill" style={{ flex: 1 }} disabled={bBusy} onClick={() => void doPick()}>
            导入备份
          </button>
        </div>

        <div className="flabel" style={{ margin: '12px 2px 6px' }}>导出内容</div>
        <div className="seg">
          <button className={!withKey ? 'on' : ''} onClick={() => setWithKey(false)}>不含 API Key</button>
          <button className={withKey ? 'on' : ''} onClick={() => setWithKey(true)}>含 API Key</button>
        </div>
        <div className="seg" style={{ marginTop: 6 }}>
          <button className={!withPhotos ? 'on' : ''} onClick={() => setWithPhotos(false)}>不含照片</button>
          <button className={withPhotos ? 'on' : ''} onClick={() => setWithPhotos(true)}>含照片（体积大）</button>
        </div>

        <div className="hint" style={{ textAlign: 'left', marginTop: 7 }}>
          {bMsg ?? (
            withKey
              ? '含 Key 的备份等同明文，别发给别人。导入时本机已有 Key 不会被覆盖。'
              : '内置食物库不进备份（新设备会自动重建），只导出你自己加的食物和全部记录。'
          )}
        </div>

        {preview && (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="title row">
              <span>备份内容</span>
              <span style={{ fontSize: 10, color: 'var(--mute)' }}>{fmtTime(preview.sum.exportedAt)}</span>
            </div>
            <div className="krow">
              <span className="k">餐次</span>
              <span className="v">{preview.sum.meals}<small>条 / {preview.sum.days} 天</small></span>
            </div>
            {preview.sum.from && (
              <div className="krow">
                <span className="k">日期范围</span>
                <span className="v" style={{ fontSize: 11 }}>
                  {preview.sum.from}{preview.sum.to && preview.sum.to !== preview.sum.from ? ` ~ ${preview.sum.to}` : ''}
                </span>
              </div>
            )}
            <div className="krow">
              <span className="k">自定义食物</span>
              <span className="v">{preview.sum.foods}<small>条</small></span>
            </div>
            <div className="krow">
              <span className="k">体重 / 目标 / 建议</span>
              <span className="v" style={{ fontSize: 11 }}>
                {preview.sum.weights} / {preview.sum.goals} / {preview.sum.advices}
              </span>
            </div>
            {preview.sum.chat > 0 && (
              <div className="krow">
                <span className="k">聊天记录</span>
                <span className="v">{preview.sum.chat}<small>条</small></span>
              </div>
            )}
            {preview.sum.photos > 0 && (
              <div className="krow">
                <span className="k">照片</span>
                <span className="v">{preview.sum.photos}<small>张</small></span>
              </div>
            )}
            {preview.sum.hasKey && (
              <div className="krow">
                <span className="k">含 API Key</span>
                <span className="v" style={{ fontSize: 11, color: 'var(--green)' }}>本机没有 Key 时会恢复</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="pill ok" style={{ flex: 1 }} disabled={bBusy} onClick={() => void doImport()}>
                {bBusy ? '导入中…' : '确认合并'}
              </button>
              <button className="pill" onClick={() => { setPreview(null); setBMsg(null); }}>取消</button>
            </div>
            <div className="hint" style={{ textAlign: 'left', marginTop: 7 }}>
              合并，不覆盖：本机已有的记录不会被删除，只补进缺的、冲突的取较新的一方。同一个文件导两次不会有变化。
            </div>
          </div>
        )}

        <ImeDiag />
        {/* 构建戳：wb 版页面来自线上站，出问题先确认设备上跑的是哪一版，别再猜 */}
        <div className="hint" style={{ marginTop: 8, fontSize: 10, opacity: 0.75 }}>
          界面版本 {__BUILD__}
        </div>

        <button
          style={{ width: '100%', marginTop: 18, padding: '12px 0', fontSize: 12.5, color: '#fca5a5' }}
          onClick={() => void wipe()}
        >
          清空全部本地数据
        </button>

        <div className="hint">
          清空前建议先导出一份备份 —— 这一步不可撤销。
        </div>

        <button
          style={{ width: '100%', marginTop: 10, padding: '12px 0', fontSize: 12.5, color: 'var(--dim)' }}
          onClick={() => nav(-1)}
        >
          返回
        </button>
      </div>
    </>
  );
}
