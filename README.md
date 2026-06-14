# VocaleezAI

Outil **local et open-source** de transcription, traduction, synthèse vocale et génération de **podcasts multi-voix** à partir de vidéos YouTube, de fichiers (audio/vidéo/documents) ou de texte.

Vous apportez vos propres clés API (ou utilisez les fournisseurs gratuits). L'application route automatiquement les requêtes entre vos fournisseurs avec repli en cas d'erreur ou de quota atteint.

## Fonctionnalités

- 🎙️ **Transcription** (Whisper via Groq ou OpenAI)
- 🌍 **Traduction** multilingue (Groq, OpenRouter, OpenAI, Gemini, + fournisseurs **gratuits** Pollinations / LLM7)
- 🔊 **Synthèse vocale** (ElevenLabs, OpenAI, Gemini, + repli local **Piper** / Edge / Google)
- 📻 **Podcast multi-voix** (2 à 4 intervenants, ton réglable, jingles)
- 🔁 **Routage multi-clés** avec failover automatique et tiers gratuits
- 🔒 Clés API **chiffrées au repos** (AES-256-GCM), jamais stockées en clair

## Stack

Vite + React + TypeScript + Tailwind/shadcn-ui (frontend) · Express + Prisma + SQLite (backend) · `tsx`.

## Prérequis

- **Node.js 18+** et npm
- *(optionnel)* [Piper](https://github.com/rhasspy/piper) pour le TTS local sans clé — voir `npm run setup:piper` (macOS/Linux) ou `npm run setup:piper:win` (Windows)
- *(optionnel)* `ffmpeg` / `yt-dlp` pour certaines fonctions vidéo/YouTube

## Installation

```sh
git clone <URL_DU_DEPOT>
cd vocaleez-ai
npm install
npm run dev
```

`npm run dev` synchronise automatiquement la base (`prisma db push`) puis lance le frontend et l'API. Ouvrez l'URL indiquée par Vite (par défaut http://localhost:8080).

**Lancement en un seul service** (build + serveur sur un seul port) :

```sh
npm start
# puis ouvrez http://localhost:3001
```

> Aucune authentification : l'app est mono-utilisateur, prévue pour un usage local.

## Ajouter ses clés

- **Depuis l'interface** : *Paramètres → choisir un fournisseur → coller la clé*. Elle est chiffrée et stockée localement (jamais renvoyée en clair).
- **Depuis `.env`** : copiez `.env.example` en `.env` et renseignez les clés souhaitées (toutes optionnelles ; voir le fichier pour le détail).

Sans aucune clé, la **traduction** reste utilisable via les fournisseurs gratuits (Pollinations, LLM7) et le **TTS** via Piper local. La **transcription** nécessite une clé Groq ou OpenAI.

## Notes

- Données stockées en local dans `prisma/dev.db` (SQLite).
- La clé de chiffrement des clés API est **générée automatiquement** au premier lancement (`.encryption-key`, ignoré par git). Sauvegardez-la si vous voulez pouvoir relire vos clés après une réinstallation — sinon il suffira de les re-saisir.
- Le port se règle via `PORT` (défaut 3001) ; le proxy de dev s'aligne automatiquement.
