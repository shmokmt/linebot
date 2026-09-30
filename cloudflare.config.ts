import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "linebot",
		compatibilityDate: "2026-09-12",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
		domains: ["linebot.shmokmt.dev"],
		env: {
			AI: bindings.ai({}),
			// Secrets are set for production with:
			//   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --name linebot
			//   npx wrangler secret put LINE_CHANNEL_SECRET --name linebot
			// (cf cannot set a single secret yet — see https://developers.cloudflare.com/cf/wrangler/reference/)
			// or upload via `cf deploy --secrets-file <PATH>`.
			// For local dev, put them in .dev.vars instead (see .dev.vars.example).
			LINE_CHANNEL_ACCESS_TOKEN: bindings.secret(),
			LINE_CHANNEL_SECRET: bindings.secret(),
		},
	},
});
