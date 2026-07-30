# Vocaleez

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

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

- **Node.js 18+** et npm (Node 20 recommandé, voir `.nvmrc`).
- **[ffmpeg](https://ffmpeg.org/download.html)** — **requis** pour la synthèse vocale (assemblage des segments), la fusion audio/vidéo, la combinaison d'audios et le découpage. Doit être dans le `PATH`.
  - macOS : `brew install ffmpeg` · Debian/Ubuntu : `sudo apt install ffmpeg` · Windows : `winget install ffmpeg` (ou [build officiel](https://www.gyan.dev/ffmpeg/builds/)).
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — **requis** pour le mode **YouTube** (URL). Non nécessaire pour les modes Fichier / Texte.
  - `pip install yt-dlp` (ou `winget install yt-dlp`). L'app détecte aussi `python -m yt_dlp`.
- **[Piper](https://github.com/rhasspy/piper)** *(optionnel)* — TTS **local et gratuit** (sans clé API). Installez-le via `npm run setup:piper` (macOS/Linux) ou `npm run setup:piper:win` (Windows).

> Au démarrage, le serveur affiche un **récapitulatif des dépendances** (`[Preflight] …`) et l'interface signale par un bandeau si `ffmpeg` ou `yt-dlp` manquent.

## Installation

```sh
git clone <URL_DU_DEPOT>
cd vocaleez
npm install
npm run setup:piper       # optionnel : TTS local gratuit (setup:piper:win sous Windows)
npm run dev
```

`npm run dev` synchronise automatiquement la base (`prisma db push`) puis lance le frontend et l'API. Ouvrez l'URL indiquée par Vite (par défaut http://localhost:8080).

> 🧪 Pour tester l'application pas à pas (installation à froid + chaque fonctionnalité), suivez le [guide de test](./TESTING.md).

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

### Variables d'environnement

Toutes optionnelles. Copiez `.env.example` en `.env`.

| Variable | Rôle | Défaut |
|---|---|---|
| `OPENAI_API_KEY` | Transcription (Whisper), traduction, TTS | — |
| `GROQ_API_KEY` | Transcription Whisper + traduction (rapide) | — |
| `OPENROUTER_API_KEY` | Repli traduction / LLM + génération d'image | — |
| `ELEVENLABS_API_KEY` | Synthèse vocale premium | — |
| `GOOGLE_API_KEY` | Gemini (traduction + TTS podcast multi-voix) | — |
| `DATABASE_URL` | Emplacement de la base SQLite | `file:./prisma/dev.db` |
| `PORT` | Port du serveur API | `3001` |
| `ENCRYPTION_KEY` | Clé (hex 64) de chiffrement des clés stockées | auto-générée |

## Dépannage

- **« Impossible de contacter le serveur »** dans l'UI → le backend n'est pas lancé. Lancez `npm run dev` (ou `npm run dev:server`).
- **Bandeau « Dépendances système manquantes »** → installez `ffmpeg` et/ou `yt-dlp` (voir Prérequis), puis relancez le serveur.
- **Le mode YouTube échoue** → `yt-dlp` absent ou obsolète : `pip install -U yt-dlp`.
- **Aucun son généré / erreur au moment du TTS** → `ffmpeg` absent du `PATH`. Vérifiez avec `ffmpeg -version`.
- **Réinitialiser les données locales** → supprimez `prisma/dev.db` (les vidéos/playlists/clés seront perdues) puis relancez.

## Notes

- Données stockées en local dans `prisma/dev.db` (SQLite).
- La clé de chiffrement des clés API est **générée automatiquement** au premier lancement (`.encryption-key`, ignoré par git). Sauvegardez-la si vous voulez pouvoir relire vos clés après une réinstallation — sinon il suffira de les re-saisir.
- Le port se règle via `PORT` (défaut 3001) ; le proxy de dev s'aligne automatiquement.
- **Base de données** : le schéma est synchronisé automatiquement au lancement (`prisma db push`). Une migration versionnée (`prisma/migrations/`) est aussi fournie ; sur une base neuve, vous pouvez utiliser `npm run db:migrate` à la place.
