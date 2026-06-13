require('dotenv').config();
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PgSession = connectPgSimple(session);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'social-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) { res.status(400).json({ error: 'username, email, and password are required' }); return; }
  const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (existing.rows.length) { res.status(409).json({ error: 'Email already registered' }); return; }
  const hash = await bcrypt.hash(password, 10);
  const { rows: [user] } = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username, email',
    [username, email, hash]
  );
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: 'Session error' }); return; }
    res.status(201).json({ id: user.id, username: user.username, email: user.email });
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) { res.status(400).json({ error: 'email and password are required' }); return; }
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' }); return;
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: 'Session error' }); return; }
    res.json({ id: user.id, username: user.username, email: user.email });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  res.json({ id: req.session.userId, username: req.session.username });
});

// ── Posts ─────────────────────────────────────────────────────────────────────
app.get('/api/feed', requireAuth, async (req, res) => {
  const { rows: following } = await pool.query(
    'SELECT following_id FROM follows WHERE follower_id=$1', [req.session.userId]
  );
  const ids = [req.session.userId, ...following.map(f => f.following_id)];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const { rows: posts } = await pool.query(
    `SELECT p.id, p.content, p.created_at,
       json_build_object('id',u.id,'username',u.username) AS author
     FROM posts p JOIN users u ON u.id=p.user_id
     WHERE p.user_id IN (${placeholders}) ORDER BY p.created_at DESC`,
    ids
  );
  const withMeta = await Promise.all(posts.map(async post => {
    const { rows: likes } = await pool.query('SELECT user_id FROM likes WHERE post_id=$1', [post.id]);
    const { rows: comments } = await pool.query('SELECT id FROM comments WHERE post_id=$1', [post.id]);
    return { ...post, likeCount: likes.length, commentCount: comments.length, liked: likes.some(l => l.user_id === req.session.userId) };
  }));
  res.json(withMeta);
});

app.get('/api/posts', async (req, res) => {
  const { rows: posts } = await pool.query(
    `SELECT p.id, p.content, p.created_at,
       json_build_object('id',u.id,'username',u.username) AS author
     FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC`
  );
  const withMeta = await Promise.all(posts.map(async post => {
    const { rows: likes } = await pool.query('SELECT id FROM likes WHERE post_id=$1', [post.id]);
    const { rows: comments } = await pool.query('SELECT id FROM comments WHERE post_id=$1', [post.id]);
    return { ...post, likeCount: likes.length, commentCount: comments.length };
  }));
  res.json(withMeta);
});

app.post('/api/posts', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content) { res.status(400).json({ error: 'content is required' }); return; }
  const { rows: [post] } = await pool.query(
    'INSERT INTO posts (user_id, content) VALUES ($1,$2) RETURNING *',
    [req.session.userId, content]
  );
  res.status(201).json(post);
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [post] } = await pool.query('SELECT user_id FROM posts WHERE id=$1', [id]);
  if (!post) { res.status(404).json({ error: 'Post not found' }); return; }
  if (post.user_id !== req.session.userId) { res.status(403).json({ error: 'Not your post' }); return; }
  await pool.query('DELETE FROM posts WHERE id=$1', [id]);
  res.sendStatus(204);
});

// ── Comments ──────────────────────────────────────────────────────────────────
app.get('/api/posts/:id/comments', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows } = await pool.query(
    `SELECT c.id, c.content, c.created_at,
       json_build_object('id',u.id,'username',u.username) AS author
     FROM comments c JOIN users u ON u.id=c.user_id
     WHERE c.post_id=$1 ORDER BY c.created_at`,
    [id]
  );
  res.json(rows);
});

app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (isNaN(postId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { content } = req.body;
  if (!content) { res.status(400).json({ error: 'content is required' }); return; }
  const { rows: [comment] } = await pool.query(
    'INSERT INTO comments (post_id, user_id, content) VALUES ($1,$2,$3) RETURNING *',
    [postId, req.session.userId, content]
  );
  res.status(201).json(comment);
});

// ── Likes ─────────────────────────────────────────────────────────────────────
app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (isNaN(postId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [existing] } = await pool.query(
    'SELECT id FROM likes WHERE post_id=$1 AND user_id=$2', [postId, req.session.userId]
  );
  if (existing) {
    await pool.query('DELETE FROM likes WHERE id=$1', [existing.id]);
    res.json({ liked: false }); return;
  }
  await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1,$2)', [postId, req.session.userId]);
  res.json({ liked: true });
});

// ── Users / Follow ────────────────────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, created_at FROM users ORDER BY username'
  );
  res.json(rows);
});

app.get('/api/users/:id/profile', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [user] } = await pool.query(
    'SELECT id, username, created_at FROM users WHERE id=$1', [id]
  );
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const { rows: posts } = await pool.query(
    'SELECT * FROM posts WHERE user_id=$1 ORDER BY created_at DESC', [id]
  );
  const { rows: followers } = await pool.query(
    'SELECT follower_id FROM follows WHERE following_id=$1', [id]
  );
  const { rows: following } = await pool.query(
    'SELECT following_id FROM follows WHERE follower_id=$1', [id]
  );
  const currentUserId = req.session.userId || null;
  const isFollowing = currentUserId ? followers.some(f => f.follower_id === currentUserId) : false;
  res.json({ ...user, posts, followerCount: followers.length, followingCount: following.length, isFollowing });
});

app.post('/api/users/:id/follow', requireAuth, async (req, res) => {
  const followingId = parseInt(req.params.id, 10);
  if (isNaN(followingId)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const followerId = req.session.userId;
  if (followerId === followingId) { res.status(400).json({ error: 'Cannot follow yourself' }); return; }
  const { rows: [existing] } = await pool.query(
    'SELECT id FROM follows WHERE follower_id=$1 AND following_id=$2', [followerId, followingId]
  );
  if (existing) {
    await pool.query('DELETE FROM follows WHERE id=$1', [existing.id]);
    res.json({ following: false }); return;
  }
  await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)', [followerId, followingId]);
  res.json({ following: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Social media server running on http://localhost:${PORT}`));
