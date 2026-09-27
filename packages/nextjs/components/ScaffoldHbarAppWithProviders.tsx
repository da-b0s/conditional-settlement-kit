"use client";

import { useEffect, useState } from "react";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { useTheme } from "next-themes";
import { Toaster } from "react-hot-toast";
import { hederaTestnet } from "viem/chains";
import { WagmiProvider } from "wagmi";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { WalletReconnectGate } from "~~/components/WalletReconnectGate";
import { BlockieAvatar } from "~~/components/scaffold-hbar";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <div className="flex flex-col min-h-screen">
        {/* First focusable element on every page. A keyboard user would
            otherwise tab through the whole nav and the wallet button before
            reaching content. Visually hidden until focused. */}
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Header />
        <main id="main-content" tabIndex={-1} className="relative flex flex-col flex-1">
          {children}
        </main>
        <Footer />
      </div>
      <Toaster />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const ScaffoldHbarAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // The wallet modal is the one surface RainbowKit paints itself, so its
  // palette has to be handed over explicitly or it falls back to RainbowKit's
  // stock indigo — which is exactly the generic accent this theme replaced.
  // These are --color-primary / --color-primary-content from globals.css.
  const rainbowKitTheme = (isDark: boolean) =>
    (isDark ? darkTheme : lightTheme)({
      accentColor: isDark ? "#8ba5ff" : "#0031ff",
      accentColorForeground: isDark ? "#101214" : "#ffffff",
      // "large" is 20px+ and floats away from the 6-12px scale the rest of the
      // UI uses. "medium" lands on it.
      borderRadius: "medium",
      fontStack: "system",
      overlayBlur: "small",
    });

  // Before mount the theme is unknown, so render light and let the effect
  // correct it; picking either is a guess, and light is the SSR default.
  const walletTheme = rainbowKitTheme(mounted && isDarkMode);

  return (
    // reconnectOnMount={false} so nothing reconnects before WalletReconnectGate
    // has checked whether the user pressed Disconnect. The gate then performs
    // the reconnection wagmi would have done, when it is wanted.
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        {/* Was #2299dd — a blue belonging to no palette in this project. */}
        <ProgressBar height="3px" color={mounted && isDarkMode ? "#8ba5ff" : "#0031ff"} />
        {/* No coolMode: it fires a confetti burst on every wallet connect,
            which undercuts a tool whose whole claim is that it is careful. */}
        <WalletReconnectGate />
        <RainbowKitProvider avatar={BlockieAvatar} initialChain={hederaTestnet} theme={walletTheme}>
          <ScaffoldHbarApp>{children}</ScaffoldHbarApp>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
