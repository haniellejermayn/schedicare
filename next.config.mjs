/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // The old Integrations and Admin pages live in Settings tabs now.
    return [
      { source: "/integrations", destination: "/settings?tab=connections", permanent: false },
      { source: "/admin", destination: "/settings?tab=demo", permanent: false },
    ];
  },
  // cpus:1 + workerThreads:false serialize static generation: the parallel
  // export workers race the 404/500 rename step on overlay filesystems
  // (container/CI), which intermittently kills the build at the last step.
  experimental: { serverComponentsExternalPackages: ["better-sqlite3"], cpus: 1, workerThreads: false },
};
export default nextConfig;
