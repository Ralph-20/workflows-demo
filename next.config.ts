import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // ajv reaches for `require` at runtime, which Turbopack cannot bundle into
  // the generated workflow step route.
  serverExternalPackages: ["ajv"],
};

// Compiles the "use workflow" / "use step" directives in lib/workflows/.
export default withWorkflow(nextConfig);
