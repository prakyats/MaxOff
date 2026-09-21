import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` otherwise appends its own block to CLAUDE.md on every run.
  // CLAUDE.md is hand-written project memory, so we keep Next out of it.
  // Next 16's own guidance lives in `node_modules/next/dist/docs/`.
  agentRules: false,
  // OpenNext / Cloudflare Workers configuration arrives in task 0.5 (ADR-0003).
};

export default nextConfig;
