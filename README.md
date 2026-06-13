# Task 2 — Social Media Platform

CodeAlpha Full Stack Internship · Task 2

A full-stack social media platform with posts, comments, likes, follow system, and user profiles.

## Features
- User registration & login (session-based auth)
- Create, view, and delete posts
- Like / unlike posts
- Comment on posts
- Follow / unfollow users
- Personalized feed (posts from followed users)
- User profile pages with follower/following counts

## Tech Stack
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Auth:** bcryptjs + express-session + connect-pg-simple
- **Frontend:** Vanilla HTML/CSS/JavaScript

## Setup

### 1. Prerequisites
- Node.js 18+
- PostgreSQL database

### 2. Clone & install
```bash
git clone <your-repo-url>
cd task2-social
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env and set your DATABASE_URL and SESSION_SECRET
```

### 4. Set up database
```bash
psql $DATABASE_URL -f schema.sql
```

### 5. Run
```bash
npm start
# Server runs at http://localhost:3001
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Register a new user |
| POST | /api/auth/login | — | Login |
| POST | /api/auth/logout | ✓ | Logout |
| GET | /api/auth/me | ✓ | Get current user |
| GET | /api/feed | ✓ | Personalized feed |
| GET | /api/posts | — | All posts |
| POST | /api/posts | ✓ | Create a post |
| DELETE | /api/posts/:id | ✓ | Delete own post |
| GET | /api/posts/:id/comments | — | Get comments |
| POST | /api/posts/:id/comments | ✓ | Add comment |
| POST | /api/posts/:id/like | ✓ | Toggle like |
| GET | /api/users | — | List users |
| GET | /api/users/:id/profile | — | User profile |
| POST | /api/users/:id/follow | ✓ | Toggle follow |
