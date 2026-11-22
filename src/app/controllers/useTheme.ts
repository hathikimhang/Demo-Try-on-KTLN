import { useEffect, useState } from 'react';
export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121016' : '#f7f7fa');
    try {
      localStorage.setItem('mira-theme', theme);
    }
    catch { /* Theme vẫn hoạt động khi trình duyệt không cho dùng bộ nhớ cục bộ. */ }
  }, [theme]);
  const themeAction = theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối';
  return { theme, setTheme, themeAction };
}
