# ClipMotion

Paste a link, get video ads. Mobile-first web app for **clipmotion.ai**: URL → scan → SaaS or e-commerce → three AI video ads with voice-over, captions and music.

1. **Link** – paste a website or product page.
2. **Scan** – the server reads the page: copy, logo and the full product record. Sources, in order: Shopify product JSON (`/products/<handle>.js`), WooCommerce variation data, structured data (Product / ProductGroup), zoom galleries, links and inline scripts. Images are upgraded to full size and de-duplicated; colours, sizes and per-variant prices are offered in the wizard.
3. **Setup** – confirm SaaS or e-commerce; for e-commerce pick the variant and the photos, or add your own.
4. **Ads** – the AI writes three ads; the video is exported frame by frame to MP4 in the browser (9:16, 1:1, 16:9; 720p/1080p; auto length or an exact 10/15/20/30 s).

**SaaS**: stock footage plus the real site inside a phone (one straight demo, one tilted view).
**E-commerce**: built from the real product photos. The AI picks usable photos; the plain background is removed (the product is never regenerated) and the product is staged on a code-drawn studio set or an optional AI-generated backdrop, with close-ups, verified badges and the listed price. Stock footage is optional.

Both: real logo and logo-derived palette, varied transitions, voice-over, word-by-word captions, 30 synthesized music tracks (`public/music.js`).

| Service | Role |
| --- | --- |
| OpenRouter free vision model → Groq (free, text) → Vertex AI / Gemini → OpenRouter paid | visual analysis + script, cheapest first. For e-commerce a vision model goes first (product-photo check) |
| OpenRouter image model (paid, optional) | custom backdrop behind the cut-out product |
| Pixabay | stock footage |
| Deepgram Aura | voice-over |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0, vendored in `public/vendor`) | H.264 MP4 encoding through WebCodecs |
| mShots (WordPress.com) | mobile screenshot of the site |
| Poppins (OFL, in `public/fonts`) | video typography |

## Landing page and plans

`public/index.html` holds the landing page (pitch, pricing, FAQ) and the wizard. Plans come from `/api/config`: set `PLANS_JSON` to change them and `CHECKOUT_PRO` / `CHECKOUT_BUSINESS` to plug in payment links (without a link the button reads "Coming soon"). Default prices are placeholders.

## Run

```bash
cp .env.example .env   # then fill in the keys
npm start              # http://localhost:3000
```

No npm dependencies (Node ≥ 20). Keys stay on the server (`/api/*`), never in the browser.

## Deploy on Vercel

`public/` is served statically and `api/*.js` as functions. Add the variables from `.env.example` under *Settings → Environment Variables*.
