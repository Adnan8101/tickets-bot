# 🎟️ Beru Tickets 2.0

**Professional Discord Ticket Tool Bot** built on the **Universal Interaction System** architecture.

## ✨ Features

- 🎯 **Dynamic Ticket Panels** — Configure via interactive Discord embeds
- 💾 **SQLite-Backed** — All data stored in universal database
- 🔄 **Autosave System** — Never lose configuration progress
- 🎨 **Full Customization** — Colors, emojis, questions, roles
- 📋 **Claim System** — Staff can claim tickets
- 📝 **HTML Transcripts** — Export identical to Ticket Tool format
- 🔒 **Restart-Safe** — Fully stateful architecture
- ⚡ **Zero Interaction Failures** — Deferred response system

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your bot token and client ID.

### 3. Build & Run

```bash
npm run build
npm start
```

Or for development:

```bash
npm run dev
```

## 📚 Commands

### `/ticket panel setup`
Opens the interactive Setup Wizard to create a new ticket panel.

### `/ticket panel edit`
Edit an existing panel through the Setup Wizard.

### `/ticket panel delete`
Delete a configured panel.

### `/ticket panel list`
View all configured ticket panels.

## 🏗️ Architecture

### Core Systems

- **Universal Database** (`/core/db/`) — SQLite-based data layer
- **Interaction Router** (`/core/interactionRouter.ts`) — Handles all buttons/modals/dropdowns
- **Embed Controller** (`/core/embedController.ts`) — Dynamic embed rebuilding
- **Error Handler** (`/core/errorHandler.ts`) — Centralized error management
- **Startup Loader** (`/core/startupLoader.ts`) — Restore state on boot

### Modules

- **Ticket System** (`/modules/ticket/`) — Setup wizard, ticket handling, transcripts
- **Commands** (`/commands/`) — Slash command definitions

## 📖 Documentation

Full specification available in `/docs/SPECIFICATION.md`

## 🛠️ Tech Stack

- **Discord.js** v14 — Discord API wrapper
- **TypeScript** — Type-safe development
- **better-sqlite3** — High-performance SQLite driver
- **Node.js** — Runtime environment

## 📝 License

MIT License — See LICENSE file for details

## 🤝 Support

For issues or questions, please open an issue on GitHub.

---

**Powered by Xieron** • Built with ❤️
