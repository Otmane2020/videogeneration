# AdReel

Appli mobile-first : **URL → inspection → SaaS ou E-com → pubs vidéo** avec voix off.

1. **URL** – on colle l'adresse du site ou de la fiche produit.
2. **Inspection** – le serveur lit la page : titres, images, logo, fiche produit structurée (nom, prix, photos).
3. **SaaS ou E-com** – l'utilisateur confirme ; en e-commerce il peut ajouter ses propres photos.
4. **Pubs** – l'IA écrit 3 pubs ; export MP4 image par image dans le navigateur (9:16, 1:1, 16:9, 720p/1080p, durée auto ou imposée à l'image près).

**SaaS** : plans Pixabay + le vrai site dans un téléphone animé (incliné, rotation, zoom caméra).
**E-commerce** : la pub est montée à partir des vraies photos du produit. L'IA choisit les photos utilisables ; le fond uni est retiré (le produit n'est jamais régénéré), puis le produit est posé sur un décor de studio adapté à la catégorie, avec gros plans, atouts vérifiés et prix (uniquement s'il figure dans les données de la fiche). Pixabay n'est qu'un appoint facultatif.

Dans les deux cas : vrai logo et couleurs tirées du logo, transitions variées, voix off, sous-titres mot à mot, 30 mélodies synthétisées (`public/music.js`).

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
