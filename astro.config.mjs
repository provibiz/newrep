// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import cloudflare from '@astrojs/cloudflare';

// Cloudflare Workers haben kein `MessageChannel`, das die
// "browser"-Build von react-dom/server benötigt. Im Build auf die
// workerd-kompatible "edge"-Variante umleiten.
const isBuild = process.argv.includes('build');

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: cloudflare(),
	integrations: [react(), keystatic()],
	vite: {
		resolve: {
			alias: isBuild ? { 'react-dom/server': 'react-dom/server.edge' } : {},
		},
	},
});
