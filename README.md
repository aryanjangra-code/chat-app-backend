# GroupChat API

The API for GroupChat handles accounts, room membership, message history, and live chat events. It uses Express for HTTP routes, MongoDB through Mongoose for persistence, and Socket.IO for real-time communication.

## Requirements

- Node.js and npm
- A MongoDB connection string

## Configure

Create `.env` in this backend directory:

```env
MONGO_URI=mongodb://127.0.0.1:27017/groupchat
JWT_SECRET=replace-with-a-long-random-secret
CLIENT_URL=http://localhost:5173
PORT=5000
```

`JWT_SECRET` is required. Keep `.env` private; it is excluded from Git. `CLIENT_URL` must match the browser origin used by the frontend. `PORT` is optional and defaults to `5000`.

## Start the server

```bash
npm install
npm run dev
```

Use `npm start` to run without nodemon. The health endpoint is `GET /api/health`.

## HTTP routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create an account |
| `POST` | `/api/auth/login` | Sign in and receive a JWT |
| `GET` | `/api/auth/me` | Get the signed-in user |
| `GET` | `/api/auth/users` | List other users |
| `GET` | `/api/rooms` | List discoverable groups and the user’s DMs |
| `POST` | `/api/rooms/group` | Create a group room |
| `POST` | `/api/rooms/:roomId/join` | Join a group room |
| `POST` | `/api/rooms/dm/:otherUserId` | Find or create a direct message |
| `GET` | `/api/rooms/:roomId/messages` | Read room history |

Routes under `/api/auth` and `/api/rooms` require a session cookie or `Authorization: Bearer <token>`, except signup and login. Browser requests use the `gc_token` HTTP-only cookie. State-changing cookie-authenticated requests must also send the `gc_csrf` cookie value in the `X-CSRF-Token` header.

## Room access

Group rooms are visible to signed-in users so they can be discovered. A user must join before reading history or sending messages. Direct-message rooms are limited to their two members. Socket.IO connections authenticate with the JWT supplied in the handshake’s `auth.token` field and apply the same room membership checks.

## Tests

```bash
npm test
npm run test:integration
```

The unit tests run locally. The integration test requires this server to be running against a **disposable MongoDB database**. It creates temporary users and rooms, checks the HTTP and Socket.IO flows, then removes the records it created.
