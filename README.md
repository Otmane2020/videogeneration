# AdReel

Appli mobile-first : **URL → inspection → SaaS ou E-com → pubs vidéo** avec voix off.

1. **URL** – on colle l'adresse du site.
2. **Inspection** – le serveur lit la page (titres, description, images, prix) et estime le type.
3. **SaaS ou E-com** – l'utilisateur confirme ; l'IA (vision) regarde les visuels et écrit 3 pubs.
4. **Pubs** – plans Pixabay + voix Deepgram, montage en direct dans le navigateur (9:16, 1:1, 16:9), téléchargement / partage.

| Service | Rôle |
| --- | --- |
| OpenRouter (Gemini) → Gemini → Groq (Llama Vision) | analyse visuelle + script, avec bascule automatique |
| Pixabay | vidéos libres de droits |
| Deepgram Aura | voix off |

## Lancer

```bash
cp .env.example .env   # puis renseigner les clés
npm start              # http://localhost:3000
```

Aucune dépendance npm (Node ≥ 20). Les clés restent côté serveur (`/api/*`), jamais dans le navigateur.

## Déployer sur Vercel

`public/` est servi en statique et `api/*.js` en fonctions. Ajouter les 5 variables de `.env.example` dans *Settings → Environment Variables*.
