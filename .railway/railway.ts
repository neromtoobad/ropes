import { defineRailway, project, service } from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "the-climb";

export default defineRailway(() => {
  const climb = service("the-climb", {
    build: "npx prisma generate",
    start: "bash start-prod.sh",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    // builder from CaC: "NIXPACKS"
  });
  return project("the-climb", {
    resources: [climb],
  });
});
