# Secret Santa Web App

A festive Secret Santa party organizer with Christmas theme and snow animations.

## Preview

![Secret Santa App Screenshot](public/screenshot.png)

## Features

- Create Secret Santa parties
- Automatic random assignment with no double-ups
- Set budget limits and gift criteria
- Secure unique guest links (no snooping!)
- Beautiful Christmas theme with snow animations
- Docker deployment ready

## Configuration

Create a `.env` file with your settings:

```env
# Server port (default: 8003)
PORT=8003

# Base URL for generating guest links
# For local development:
BASE_URL=http://localhost:8003
# For production deployment:
BASE_URL=https://your-domain.com
```

**Important:** Set `BASE_URL` to your production domain when deploying, as this URL is used to generate the guest invitation links.

## Quick Start with Docker

1. **Build and run with Docker Compose:**
   ```bash
   docker-compose up --build
   ```

2. **Access the app:**
   - Local URL: `http://localhost:8003`

## Manual Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **For development:**
   ```bash
   npm run dev
   ```

## Usage

1. **Create a Party:**
   - Visit the main page
   - Enter party name, budget (optional), and criteria (optional)
   - Add guest names (minimum 2, include yourself if participating!)
   - Click "Create Secret Santa Party"

2. **Share with Guests:**
   - Copy the individual personal links for each guest
   - Each person gets their own unique link
   - The party creator uses their personal link just like everyone else

3. **Guest Participation:**
   - Each person visits their unique personal link
   - They immediately see who they're buying a gift for
   - Assignments are kept secret and secure!

## Technology Stack

- **Backend:** Node.js with Express
- **Frontend:** HTML5, CSS3, JavaScript, Tailwind CSS
- **Styling:** Christmas theme with custom animations
- **Deployment:** Docker & Docker Compose
- **Data Storage:** In-memory (for demo purposes)

## Docker Deployment

The app is configured to run on `0.0.0.0:8003` using Docker:

- **Port:** 8003
- **Container Name:** secret-santa-app
- **Restart Policy:** unless-stopped

**For Production:** Update the `BASE_URL` environment variable in `docker-compose.yml` to your actual domain before deploying.

## Notes

- Uses file-based storage with automatic backups
- Parties and assignments persist between server restarts
- The assignment algorithm ensures no one gets themselves
- All assignments are generated once per party and saved

## Merry Christmas! 🎅🎄❄️
