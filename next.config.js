/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp is externalized by Next.js automatically; ffmpeg-static isn't,
  // so webpack bundles its JS wrapper and breaks the __dirname-based lookup
  // it uses to find its own binary. Externalizing keeps it a normal
  // node_modules require() at runtime, where that lookup works correctly.
  experimental: {
    serverComponentsExternalPackages: ['ffmpeg-static'],
    // The binary is accessed via a computed file path, not require()/import,
    // so Next's output-file-tracing can't see it's needed and prunes it from
    // the deployment bundle. Force it back in.
    outputFileTracingIncludes: {
      '/api/**/*': ['./node_modules/ffmpeg-static/**/*'],
    },
  },
};

module.exports = nextConfig;
