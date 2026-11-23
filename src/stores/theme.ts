import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

type ThemePreference = 'light' | 'dark' | 'auto';

export const useThemeStore = defineStore('theme', () => {
  // Load preference from localStorage, default to 'auto'
  // Using 'theme_mode' key to ensure fresh default for existing users
  const storedTheme = localStorage.getItem('theme_mode') as ThemePreference | null;
  const preference = ref<ThemePreference>(
    (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'auto') 
      ? storedTheme 
      : 'auto'
  );

  // System dark mode state
  const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Update systemDark when system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemChange = (e: MediaQueryListEvent) => {
    systemDark.value = e.matches;
  };
  
  // Add listener safely
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleSystemChange);
  } else {
    // Fallback for older browsers
    mediaQuery.addListener(handleSystemChange);
  }

  // Computed: is the dark mode actually active?
  const isDark = computed(() => {
    if (preference.value === 'auto') {
      return systemDark.value;
    }
    return preference.value === 'dark';
  });

  const applyTheme = () => {
    document.documentElement.classList.toggle('dark', isDark.value);
  };

  /*
   * 只在「浅色 / 深色」之间切换。
   * 「跟随系统」是没手动设置过时的默认值（preference 初始为 auto），不进切换循环 ——
   * 所以按「当前实际显示的是不是深色」取反，而不是 auto -> light -> dark 轮转。
   */
  const toggleTheme = () => {
    const currentlyDark = preference.value === 'auto' ? systemDark.value : preference.value === 'dark';
    preference.value = currentlyDark ? 'light' : 'dark';
  };

  // Watch for changes in preference or systemDark to apply theme
  watch([preference, systemDark], () => {
    applyTheme();
    localStorage.setItem('theme_mode', preference.value);
  });

  // Initialize
  applyTheme();

  return { isDark, preference, toggleTheme };
});
