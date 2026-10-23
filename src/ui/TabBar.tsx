import { Link, useLocation, useNavigate } from 'react-router-dom';

/** 导航：左右各两格，中间 FAB 直接进拍照识别。设置入口放在档案页底部，不占导航位 */
export function TabBar() {
  const { pathname } = useLocation();
  const nav = useNavigate();

  return (
    <nav className="tabbar">
      <Link to="/" className={pathname === '/' ? 'on' : ''}>
        <span className="ico">◎</span>
        <span>今日</span>
      </Link>

      <Link to="/chat" className={pathname === '/chat' ? 'on' : ''}>
        <span className="ico">◐</span>
        <span>小助手</span>
      </Link>

      <div className="fab">
        <button
          aria-label="拍照记一餐"
          className={pathname === '/capture' ? 'on' : ''}
          onClick={() => nav('/capture')}
        >
          +
        </button>
      </div>

      <Link to="/stats" className={pathname === '/stats' ? 'on' : ''}>
        <span className="ico">▤</span>
        <span>统计</span>
      </Link>

      <Link to="/profile" className={pathname === '/profile' ? 'on' : ''}>
        <span className="ico">◔</span>
        <span>档案</span>
      </Link>
    </nav>
  );
}
