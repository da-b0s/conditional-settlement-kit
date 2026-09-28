import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-hbar-ui/components/styles.css";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Talon — holds until it's true",
  description:
    "Lock HBAR into a promise that pays out automatically when a price hits your target, or comes back to you if it doesn't. On Hedera testnet.",
});

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    // lang is required for screen readers to pick the right pronunciation rules.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Light by default; the toggle switches to dark and the choice is remembered. */}
        <ThemeProvider defaultTheme="light" enableSystem={false}>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;
