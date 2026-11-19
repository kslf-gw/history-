import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { CountryExplorerWorkspace } from './components/CountryExplorerWorkspace';

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem('archivum-theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      window.localStorage.setItem('archivum-theme', 'dark');
    } else {
      root.classList.remove('dark');
      window.localStorage.setItem('archivum-theme', 'light');
    }
  }, [isDark]);

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] dark:bg-[#111110] text-[#1C1917] dark:text-[#F5F2EB] transition-colors duration-200">
      {/* Minimalist 3-Zone Top Bar */}
      <header className="sticky top-0 z-40 bg-[#FBF9F5]/90 dark:bg-[#111110]/90 backdrop-blur-md border-b border-[#E5DFD3] dark:border-[#2C2925] transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          {/* Zone 1: Wordmark */}
          <a
            href="#explorer"
            className="font-serif text-2xl font-semibold tracking-tight text-[#1C1917] dark:text-[#F5F2EB] whitespace-nowrap shrink-0"
          >
            Archivum
          </a>

          {/* Zone 2: Minimal Section Links */}
          <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-[#57534E] dark:text-[#B8B2A6]">
            <a
              href="#explorer"
              className="hover:text-[#1C1917] dark:hover:text-[#F5F2EB] transition-colors whitespace-nowrap shrink-0"
            >
              Explorer
            </a>
            <a
              href="#timeline"
              className="hover:text-[#1C1917] dark:hover:text-[#F5F2EB] transition-colors whitespace-nowrap shrink-0"
            >
              Timeline
            </a>
            <a
              href="#comparison"
              className="hover:text-[#1C1917] dark:hover:text-[#F5F2EB] transition-colors whitespace-nowrap shrink-0"
            >
              Comparison
            </a>
          </nav>

          {/* Zone 3: Theme Toggle */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setIsDark((prev) => !prev)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-[#D6CEBE] dark:border-[#3A3630] bg-[#FFFFFF] dark:bg-[#191816] text-[#1C1917] dark:text-[#F5F2EB] hover:bg-[#F3EFE7] dark:hover:bg-[#22201D] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isDark ? <Sun className="w-3.5 h-3.5 text-[#EA8C55]" /> : <Moon className="w-3.5 h-3.5 text-[#1E3A8A]" />}
              <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10">
        <CountryExplorerWorkspace isDark={isDark} />
      </main>

      <footer className="border-t border-[#E5DFD3] dark:border-[#2C2925] bg-[#F3EFE7]/40 dark:bg-[#161513] transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[#57534E] dark:text-[#8A8378]">
          <span>Archivum · Country History Explorer</span>
          <span>
            Sources: Wikipedia Chronicles · Day in History · Wikimedia · AtlasPI · Vetustas
          </span>
        </div>
      </footer>
    </div>
  );
}
