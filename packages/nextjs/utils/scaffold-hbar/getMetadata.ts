import type { Metadata } from "next";

const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : `http://localhost:${process.env.PORT || 3000}`;
const titleTemplate = "%s | Talon";

export const getMetadata = ({
  title,
  description,
  imageRelativePath = "/thumbnail.jpg",
}: {
  title: string;
  description: string;
  imageRelativePath?: string;
}): Metadata => {
  const imageUrl = `${baseUrl}${imageRelativePath}`;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: titleTemplate,
    },
    description: description,
    openGraph: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [
        {
          url: imageUrl,
        },
      ],
    },
    twitter: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [imageUrl],
    },
    icons: {
      // SVG first for browsers that take it — it stays sharp at any density.
      // The PNG is the fallback for those that do not.
      icon: [
        { url: "/talon-mark.svg", type: "image/svg+xml" },
        { url: "/talon-mark-32.png", sizes: "32x32", type: "image/png" },
      ],
      apple: [{ url: "/talon-icon-512.png", sizes: "512x512", type: "image/png" }],
    },
  };
};
