import { createContext, useContext, useEffect } from 'react';

interface ThemeCtx {
  theme: 'dark';
  setTheme: () => void;
  isDark: true;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', setTheme: () => {}, isDark: true });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <Ctx.Provider value={{ theme: 'dark', setTheme: () => {}, isDark: true }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
