import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-hbar-ui/components/styles.css";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Preflight",
  description:
    "Acquire and hold any Hedera token without hitting TOKEN_NOT_ASSOCIATED_TO_ACCOUNT. Preflight picks the right one of four association mechanisms and explains why.",
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
