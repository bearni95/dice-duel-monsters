import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// The shipped SPA. All admin tooling and its server endpoints now live in the
// separate `admin` package, so there is no admin code to guard or strip here.
export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// The frontend dev server must always run on 6030; fail rather than
		// silently pick another port when it is taken.
		port: 6030,
		strictPort: true
	}
});
