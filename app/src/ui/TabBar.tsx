import { Link, useLocation, useNavigate } from 'react-router-dom';
import { IconCamera, IconChat, IconProfile, IconStats, IconToday } from './icons';

/** 导航：左右各两格，中间 FAB 直接进拍照识别。设置入口放在档案页底部，不占导航位 */
export function TabBar() {
  const { pathname } = useLocation();
  const nav = useNavigate();

  return (
    <nav className="tabbar">
      <Link to="/" className={pathname === '/' ? 'on' : ''}>
        <span className="ico"><IconToday size={20} /></span>
        <span>今日</span>
      </Link>

      <Link to="/chat" className={pathname === '/chat' ? 'on' : ''}>
        <span className="ico"><IconChat size={20} /></span>
        <span>小助手</span>
      </Link>

      <div className="fab">
        <button
          aria-label="拍照记一餐"
          className={pathname === '/capture' ? 'on' : ''}
          onClick={() => nav('/capture')}
        >
          <IconCamera size={22} />
        </button>
      </div>

      {/* replace：已经在 /stats（可能带着 ?tab=bp）时重按底栏，否则会 push 一个
          不带分区的 /stats，既把分区冲掉又多出一条历史 */}
      <Link to="/stats" replace={pathname === '/stats'} className={pathname === '/stats' ? 'on' : ''}>
        <span className="ico"><IconStats size={20} /></span>
        <span>统计</span>
      </Link>

      <Link to="/profile" className={pathname === '/profile' ? 'on' : ''}>
        <span className="ico"><IconProfile size={20} /></span>
        <span>档案</span>
      </Link>
    </nav>
  );
}
