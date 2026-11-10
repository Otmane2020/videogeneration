# AdReel

Appli mobile-first : **URL → inspection → SaaS ou E-com → pubs vidéo** avec voix off.

1. **URL** – on colle l'adresse du site.
2. **Inspection** – le serveur lit la page (titres, description, images, prix) et estime le type.
3. **SaaS ou E-com** – l'utilisateur confirme ; l'IA (vision) regarde les visuels et écrit 3 pubs.
4. **Pubs** – plans Pixabay, capture du vrai site dans un téléphone, voix Deepgram et sous-titres mot à mot ; export MP4 image par image dans le navigateur (9:16, 1:1, 16:9), téléchargement / partage.

| Service | Rôle |
| --- | --- |
| OpenRouter (Gemini) → Gemini → Groq | analyse visuelle + script, avec bascule automatique (Groq : texte seul par défaut) |
| Pixabay | vidéos libres de droits |
| Deepgram Aura | voix off |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0, dans `public/vendor`) | encodage MP4 H.264 via WebCodecs |
| mShots (WordPress.com) | capture d'écran mobile du site |
| Poppins (OFL, dans `public/fonts`) | typographie des vidéos |

## Lancer

```bash
cp .env.example .env   # puis renseigner les clés
npm start              # http://localhost:3000
```

Aucune dépendance npm (Node ≥ 20). Les clés restent côté serveur (`/api/*`), jamais dans le navigateur.

## Déployer sur Vercel

`public/` est servi en statique et `api/*.js` en fonctions. Ajouter les 5 variables de `.env.example` dans *Settings → Environment Variables*.
