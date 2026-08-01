# DevForge AI

An AI-powered Software Engineering Platform that automatically generates, builds, and exports production-ready full-stack applications from natural language prompts.

## 🚀 Features

- 🤖 Multi-agent AI software development
- 📝 Natural language project generation
- 🎨 React frontend generation
- ⚙️ Node.js + Express backend generation
- 🗄️ Prisma ORM integration
- 🔐 Authentication system
- 📦 Download generated projects as ZIP
- 📋 Build logs and activity tracking
- 🌐 OpenRouter AI integration
- 💾 SQLite support (can be configured for PostgreSQL)

## 🛠 Tech Stack

### Frontend
- React
- Vite
- JavaScript

### Backend
- Node.js
- Express.js
- Prisma ORM
- SQLite

### AI
- OpenRouter API
- DeepSeek Chat V3 (via OpenRouter)

## 📂 Project Structure

```
client/
server/
├── src/
├── prisma/
├── generated/
└── package.json
```

## ⚡ Installation

### Clone the repository

```bash
git clone https://github.com/ganeshkumarbuilds/devforge-ai.git
cd devforge-ai
```

### Install dependencies

Frontend

```bash
cd client
npm install
npm run dev
```

Backend

```bash
cd server
npm install
npm start
```

## 🔑 Environment Variables

Create a `.env` file inside the `server` folder.

Example:

```env
OPENROUTER_API_KEY=your_api_key
DATABASE_URL="postgresql://username:password@host/database?sslmode=require"
OPENROUTER_MODEL=openrouter/free


JWT_SECRET=your_secret
```

## 🎯 Future Improvements

- Docker support
- Multi-model AI selection
- GitHub integration
- Cloud deployment
- Team collaboration
- Project versioning

## 📄 License

This project was built for the **Codex Hackathon**.

---

Developed by **Ganesh Kumar**
