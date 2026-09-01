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
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
