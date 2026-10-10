import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Cache policy. Only names that ARE content hashes get immutable: /media/catalog-pinned/<sha256>.<ext>.
// site-<key>.css is keyed by its source list (not content) and /f/*.js, /d/*, /f/404-assets/* keep names
// across edits, so they revalidate (CSS/JS/HTML) or use a bounded max-age (media).
const apacheCache = `
# --- Cache-Control / compression (mod_headers, mod_deflate) ---
# Merge worker-src 'self' into your existing Content-Security-Policy.
<IfModule mod_headers.c>
  <Files "sw.js">
    Header set Cache-Control "no-cache"
  </Files>
  <FilesMatch "\\.(html|json|xml|txt|csv|js|css)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  <FilesMatch "\\.(webp|avif|jpe?g|png|gif|svg|ico|mp4|webm|woff2?)$">
    Header set Cache-Control "public, max-age=2592000"
  </FilesMatch>
  <FilesMatch "^[0-9a-f]{64}\\.(css|js|woff2|webp|avif|jpe?g|png|gif|svg|ico)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json application/xml text/xml text/plain text/csv image/svg+xml
</IfModule>
`;
const nginxCache = `
# --- Cache-Control / compression ---
gzip on;
gzip_types text/css text/javascript application/javascript application/json application/xml text/plain text/csv image/svg+xml;
# Build assets (CSS/JS/fonts/images) are SHA256 content-addressed.
location ~ ^/assets/[0-9a-f]{64}\\.(css|js|woff2|webp|avif|jpe?g|png|gif|svg|ico)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
# Content-hashed pinned catalog photos never change.
location ~ ^/media/catalog-pinned/[0-9a-f]{64}\\.(css|js|woff2|webp|avif|jpe?g|png|gif|svg|ico)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
# Unhashed media/fonts: bounded cache.
location ~* \\.(webp|avif|jpe?g|png|gif|svg|ico|mp4|webm|woff2?)$ {
    add_header Cache-Control "public, max-age=2592000";
    try_files $uri =404;
}
# CSS/JS/data keep stable names across deploys: revalidate (ETag/Last-Modified).
location ~* \\.(css|js|json|csv|xml|txt)$ {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
}
`;

export async function buildHosting(target) {
  const redirects = JSON.parse(await readFile(new URL('../config/redirects.json', import.meta.url), 'utf8'));
  // Dedicated source copy; keep 404 independent of other pages and their CSS.
  const html = await readFile(new URL('./404.html', import.meta.url), 'utf8');
  await writeFile(join(target, '404.html'), html);
  await writeFile(join(target, '.htaccess'), `# Generated from storefront/config/redirects.json; document root is built dist.
Options -MultiViews
DirectoryIndex index.html
ErrorDocument 404 /404.html
RewriteEngine On
RewriteCond %{ENV:REDIRECT_STATUS} !=404
RewriteRule ^404[.]html$ - [R=404,L]
${Object.entries(redirects).map(([from, to]) => `RewriteRule ^${from.slice(1)}/?$ ${to} [R=301,L,NE]`).join('\n')}
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [END]
RewriteCond %{DOCUMENT_ROOT}/$1.html -f
RewriteRule ^(.+?)/?$ $1.html [END]
# No catch-all to index.html: missing URLs retain the original 404 status.
${apacheCache}`);
  await writeFile(join(target, 'nginx.conf.example'), `# Merge INTO hosting server block; root must point to built dist.
# Replace existing location / and remove every SPA fallback to /index.html.
index index.html;
# Add worker-src 'self' to the hosting's COMPLETE existing CSP manually.
# Repeat that complete CSP in locations with add_header (nginx inheritance).
# Timeweb static-nobuild support for these config files is unconfirmed.
location = /sw.js {
    add_header Cache-Control "no-cache" always;
    try_files $uri =404;
}
error_page 404 /404.html;
${Object.entries(redirects).map(([from, to]) => `location ~ ^${from}/?$ { return 301 ${to}$is_args$args; }`).join('\n')}
location = /404.html {
    internal;
    add_header X-Robots-Tag "noindex, nofollow" always;
}
location / {
    add_header Cache-Control "no-cache";
    try_files $uri $uri/ $uri.html =404;
}
${nginxCache}`);
}
