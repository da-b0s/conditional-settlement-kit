"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";

export const SwitchTheme = ({ className }: { className?: string }) => {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const isDarkMode = resolvedTheme === "dark";

  const handleToggle = () => {
    if (isDarkMode) {
      setTheme("light");
      return;
    }
    setTheme("dark");
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className={`flex space-x-2 h-8 items-center justify-center text-sm ${className ?? ""}`}>
      {/* The visible control is the icon label; the checkbox carries the semantics.
          Without aria-label a screen reader announces an unnamed checkbox, because
          the label's only content is two decorative SVGs. */}
      <input
        id="theme-toggle"
        type="checkbox"
        aria-label="Use dark theme"
        className="toggle bg-secondary toggle-primary hover:bg-accent transition-all"
        onChange={handleToggle}
        checked={isDarkMode}
      />
      <label htmlFor="theme-toggle" className={`swap swap-rotate ${!isDarkMode ? "swap-active" : ""}`}>
        <SunIcon className="swap-on h-5 w-5" aria-hidden="true" />
        <MoonIcon className="swap-off h-5 w-5" aria-hidden="true" />
      </label>
    </div>
  );
};
