import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep deployment-target agnostic: nothing here should assume Vercel.
  // Moving to AWS Amplify / ECS later should require no code change.
  images: {
    remotePatterns: [
      // Supabase Storage public buckets. Host comes from env, never hardcoded.
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [
            {
              protocol: "https" as const,
              hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
            },
          ]
        : []),
    ],
  },
  // Local development runs on admin.localhost:3000 and owner.localhost:3000.
  // Without this, `next dev` refuses dev-only resources (HMR, overlays) to
  // any origin other than plain localhost.
  allowedDevOrigins: ["admin.localhost", "owner.localhost", "*.localhost"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
