# SEO

Set up 2026-11-05. The site is a one-location business in Rosario, so local
search (Google Business Profile + a clear home page) matters far more than
anything else here.

## What's in the code

| Piece | Where | Notes |
|---|---|---|
| Defaults: title, description, Open Graph, Twitter, `metadataBase`, theme-color | `app/layout.tsx` | Strings live in `lib/site.ts` (`SITE_TITLE`, `SITE_DESCRIPTION`, `SITE_URL`). Title template is `%s · VULL`. |
| Share image | `app/opengraph-image.jpg` + `.alt.txt` | 1200×630 crop of `public/vull-image-4.jpeg`. Static on purpose: `next/og` would add a wasm renderer to the 3 MB Worker. |
| robots.txt | `app/robots.ts` | Disallows the signed-in areas. Cloudflare's managed robots.txt (content signals), if enabled for the zone, is prepended to it. |
| Sitemap | `app/sitemap.ts` | Only `/`. |
| Canonicals | `app/page.tsx`, `app/planes/page.tsx` | `/planes` → `/`. Never set `alternates.canonical` in a layout: every child inherits it. |
| noindex | `app/admin/layout.tsx`, `app/(account)/layout.tsx`, and the pages `/turno`, `/login`, `/reservar`, `/abono`, `/comprar`, `/comprar/exito` | Booking and purchase pages are UUID-keyed and transactional. They stay crawlable so bots can read the noindex. |
| Business structured data | `components/seo/local-business-jsonld.tsx` (home only) | No hours or prices: those are in the DB and the page is a build-time snapshot. |
| Indexable copy | `components/landing/about.tsx` (home, between the scene and Planes) | Server-rendered with no reveal animation, so the text is in the first HTML response. |

**Gotcha: metadata merges shallowly.** A page that sets `openGraph` replaces the
layout's whole `openGraph` object (title, locale, siteName), so spread it in or
leave it out.

## Off-repo (owner)

1. **Google Business Profile** for VULL, Montevideo 40 (Complejo Loyal), Rosario,
   with hours, photos and `https://www.vull.com.ar`. This is the biggest lever.
2. **Search Console**: add a Domain property (DNS TXT record in Cloudflare).
   Submit `https://www.vull.com.ar/sitemap.xml` **only once the real plans replace
   the "Testing env" one** and the site has been redeployed. The plan cards are
   a build-time snapshot, so a DB change shows up in the HTML only after a deploy.
3. Check the link preview after a deploy by pasting the URL in a WhatsApp chat.
   WhatsApp caches previews, so test with `?v=2` if an old one sticks.
