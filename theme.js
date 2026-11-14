(() => {
  const key = 'panopticon-theme';
  let theme = 'dark';
  try {
    if (localStorage.getItem(key) === 'light') theme = 'light';
  } catch { /* Use dark mode when browser storage is unavailable. */ }
  document.documentElement.dataset.theme = theme;

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('toggle-theme');
    function updateButton() {
      const label = theme === 'dark' ? '라이트모드' : '다크모드';
      button.textContent = label;
      button.setAttribute('aria-label', `${label}로 전환`);
      button.setAttribute('aria-pressed', String(theme === 'light'));
    }
    button.onclick = () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      updateButton();
      try { localStorage.setItem(key, theme); }
      catch { /* Switching still works without browser storage. */ }
    };
    updateButton();
  });
})();
