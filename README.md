# Secret Santa

A secure Secret Santa organizer with **end-to-end encryption** — not even the host can see anyone's assignments.

## How to Use

1. **Host creates a room** with a room name and credentials
2. **Share the room link** with participants
3. **Participants register** with their own username and password
4. **Host starts the room** once everyone has joined
5. **Everyone logs in** to see their secret assignment (fully encrypted)

## Quick Start

1. **Copy the environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Run the app:**

   **With Docker:**
   ```bash
   docker-compose up --build
   ```

   **Without Docker:**
   ```bash
   npm install
   npm start
   ```

3. **Visit** `http://localhost:8003`

## Security

All assignments are **encrypted client-side** before being sent to the server. Each participant's assignment is encrypted with their unique credentials, so only they can decrypt it. The server and host never see the plaintext assignments.

🎅🎄 Merry Christmas!
