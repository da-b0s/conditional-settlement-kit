import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-hbar-ui/components/styles.css";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Talon — holds until it's true",
  description:
    "Lock HBAR behind a price condition on Hedera testnet. Submit settlement when the condition holds, or reclaim an unsettled policy's funds after its deadline.",
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
