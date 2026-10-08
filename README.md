# Lady Elka — Cloud preview

Public repository containing only the generated static website and a dependency-free copy build.

Timeweb Cloud App Platform: frontend / HTML/CSS/JS, branch `main`, project directory `/site`. This mode serves the generated files directly and has no platform build command. For local verification, `npm run build` copies the same files to `dist`.

Since 2026-10-08 `/site` contains the production storefront build (`mode: production`, offline catalog snapshot 2026-10-08T04-59-43-880Z, Yandex Metrika script included, `404.html` present). Payment and lead endpoints point to the production Supabase functions, but CORS allows only lady-elka.ru, so checkout and lead forms are not expected to work on the Timeweb test domain. The root `build.mjs` copy helper still guards for the old preview config and is not used by the platform (framework `static-nobuild`, no build command).

Use the Timeweb test domain first. The existing main domain and backend are not switched by this repository.
