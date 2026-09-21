import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-hbar-ui/components/styles.css";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Conditional Settlement Kit",
  description:
    "Escrow a payout, attach it to a price condition, and let anyone settle it once the condition holds. Per-feed freshness bounds, a swappable oracle, and a public evidence trail on Hedera.",
});

const ScaffoldHbarApp = ({ children }: { children: React.ReactNode }) => {
  return (
    // lang is required for screen readers to pick the right pronunciation rules.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider enableSystem>
          <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldHbarApp;
