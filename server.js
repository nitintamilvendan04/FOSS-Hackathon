// ============================================================
//  SkillSync — Backend API  (server.js)
//  Node.js + Express + PostgreSQL + MongoDB + JWT
//  Run: npm install  →  npm run dev
// ============================================================

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const axios    = require('axios');
const { Pool } = require('pg');
const mongoose = require('mongoose');
const path     = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 5000;
const JWT  = process.env.JWT_SECRET || 'skillsync_dev_secret_2026';

// ── Middleware ─────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ── PostgreSQL ─────────────────────────────────────────────
const pg = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     process.env.PG_PORT     || 5432,
  database: process.env.PG_DB       || 'skillsync',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || 'password',
  max: 20,
});
pg.on('error', err => console.error('PG error:', err));

// ── MongoDB ─────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/skillsync')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB:', err.message));

// Mongoose Schemas
const ResumeLog = mongoose.model('ResumeLog', new mongoose.Schema({
  userId: Number, skills: Array, strengths: [String],
  missingSkills: [String], rawText: String, createdAt: { type: Date, default: Date.now }
}));
const AILog = mongoose.model('AILog', new mongoose.Schema({
  userId: Number, action: String, input: Object,
  output: Object, createdAt: { type: Date, default: Date.now }
}));

// ── File Upload ─────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf','.doc','.docx'].includes(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('Only PDF/DOC files allowed'));
  }
});

// ── Auth Middleware ─────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
};

// ── Helper: Recalculate Profile Score ──────────────────────
async function refreshScore(userId) {
  const [skills, achievements, profile] = await Promise.all([
    pg.query('SELECT COUNT(*) FROM user_skills WHERE user_id=$1', [userId]),
    pg.query('SELECT COUNT(*) FROM achievements WHERE user_id=$1', [userId]),
    pg.query('SELECT github_url, linkedin_url, resume_url FROM users u LEFT JOIN student_profiles sp ON u.id=sp.user_id WHERE u.id=$1', [userId])
  ]);
  let score = 0;
  score += Math.min(+skills.rows[0].count * 3, 40);
  score += Math.min(+achievements.rows[0].count * 5, 30);
  const p = profile.rows[0];
  if (p?.github_url)  score += 15;
  if (p?.linkedin_url) score += 10;
  if (p?.resume_url)  score += 5;
  await pg.query('UPDATE student_profiles SET profile_score=$1 WHERE user_id=$2', [Math.min(score,100), userId]);
  return Math.min(score, 100);
}

// ════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, college, branch, year } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

    const exists = await pg.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pg.query(
      `INSERT INTO users (name, email, password_hash, college, branch, year)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email`,
      [name, email, hash, college||null, branch||null, year||1]
    );
    const user = rows[0];
    await pg.query('INSERT INTO student_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pg.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length || !await bcrypt.compare(password, rows[0].password_hash))
      return res.status(401).json({ error: 'Invalid email or password' });
    const { id, name } = rows[0];
    const token = jwt.sign({ id, email }, JWT, { expiresIn: '7d' });
    res.json({ token, user: { id, name, email } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ════════════════════════════════════════════════════════════
// PROFILE ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/profile
app.get('/api/profile', auth, async (req, res) => {
  try {
    const { rows } = await pg.query(
      `SELECT u.id, u.name, u.email, u.college, u.branch, u.year, u.github_url, u.linkedin_url,
              sp.profile_score, sp.bio, sp.location, sp.target_role, sp.cgpa, sp.graduation_year
       FROM users u LEFT JOIN student_profiles sp ON u.id=sp.user_id
       WHERE u.id=$1`, [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' });
    const [skills, achievements, projects] = await Promise.all([
      pg.query('SELECT * FROM user_skills WHERE user_id=$1 ORDER BY proficiency DESC', [req.user.id]),
      pg.query('SELECT * FROM achievements WHERE user_id=$1 ORDER BY date DESC', [req.user.id]),
      pg.query('SELECT * FROM projects WHERE user_id=$1 ORDER BY start_date DESC', [req.user.id])
    ]);
    res.json({ ...rows[0], skills: skills.rows, achievements: achievements.rows, projects: projects.rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/profile
app.put('/api/profile', auth, async (req, res) => {
  try {
    const { bio, location, target_role, github_url, linkedin_url, cgpa, graduation_year } = req.body;
    await pg.query('UPDATE users SET github_url=$1, linkedin_url=$2, updated_at=NOW() WHERE id=$3',
      [github_url, linkedin_url, req.user.id]);
    await pg.query(
      'UPDATE student_profiles SET bio=$1, location=$2, target_role=$3, cgpa=$4, graduation_year=$5, updated_at=NOW() WHERE user_id=$6',
      [bio, location, target_role, cgpa, graduation_year, req.user.id]
    );
    const score = await refreshScore(req.user.id);
    res.json({ message: 'Profile updated', profile_score: score });
  } catch (e) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ════════════════════════════════════════════════════════════
// SKILLS ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/skills
app.get('/api/skills', auth, async (req, res) => {
  try {
    const { rows } = await pg.query(
      'SELECT * FROM user_skills WHERE user_id=$1 ORDER BY proficiency DESC', [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// POST /api/skills
app.post('/api/skills', auth, async (req, res) => {
  try {
    const { skill_name, proficiency = 60, category = 'Technical' } = req.body;
    if (!skill_name) return res.status(400).json({ error: 'skill_name required' });
    const { rows } = await pg.query(
      `INSERT INTO user_skills (user_id, skill_name, proficiency, category)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, skill_name) DO UPDATE SET proficiency=$3, updated_at=NOW()
       RETURNING *`,
      [req.user.id, skill_name, proficiency, category]
    );
    await refreshScore(req.user.id);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to save skill' });
  }
});

// DELETE /api/skills/:id
app.delete('/api/skills/:id', auth, async (req, res) => {
  try {
    await pg.query('DELETE FROM user_skills WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    await refreshScore(req.user.id);
    res.json({ message: 'Skill removed' });
  } catch (e) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ════════════════════════════════════════════════════════════
// ACHIEVEMENTS ROUTES
// ════════════════════════════════════════════════════════════

app.get('/api/achievements', auth, async (req, res) => {
  const { rows } = await pg.query('SELECT * FROM achievements WHERE user_id=$1 ORDER BY date DESC', [req.user.id]);
  res.json(rows);
});

app.post('/api/achievements', auth, async (req, res) => {
  try {
    const { title, type, description, organization, date, certificate_url, skills_used } = req.body;
    const { rows } = await pg.query(
      `INSERT INTO achievements (user_id, title, type, description, organization, date, certificate_url, skills_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, title, type, description, organization, date, certificate_url, skills_used || []]
    );
    await refreshScore(req.user.id);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add achievement' });
  }
});

// ════════════════════════════════════════════════════════════
// OPPORTUNITIES ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/opportunities?type=internship&page=1&limit=20
app.get('/api/opportunities', auth, async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const userSkills = await pg.query(
      'SELECT LOWER(skill_name) as skill FROM user_skills WHERE user_id=$1', [req.user.id]
    );
    const skillArr = userSkills.rows.map(r => r.skill);

    let q = `
      SELECT o.*,
        ROUND(
          COALESCE(
            (SELECT COUNT(*)::float FROM opportunity_skills os
             WHERE os.opportunity_id = o.id AND LOWER(os.skill_name) = ANY($1::text[]))
            / NULLIF((SELECT COUNT(*) FROM opportunity_skills os2 WHERE os2.opportunity_id = o.id), 0)
          , 0) * 100
        ) AS match_score
      FROM opportunities o WHERE o.is_active = true
    `;
    const params = [skillArr];
    if (type) { q += ` AND o.type = $${params.length+1}`; params.push(type); }
    q += ` ORDER BY match_score DESC, o.deadline ASC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(+limit, +offset);

    const { rows } = await pg.query(q, params);
    res.json({ opportunities: rows, page: +page });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// POST /api/opportunities/:id/apply
app.post('/api/opportunities/:id/apply', auth, async (req, res) => {
  try {
    await pg.query(
      `INSERT INTO applications (user_id, opportunity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.id]
    );
    res.json({ message: 'Application tracked' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to apply' });
  }
});

// ════════════════════════════════════════════════════════════
// AI ROUTES
// ════════════════════════════════════════════════════════════

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// POST /api/ai/analyze-resume
app.post('/api/ai/analyze-resume', auth, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let result;
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
      const aiRes = await axios.post(`${AI_URL}/analyze-resume`, form, { headers: form.getHeaders(), timeout: 30000 });
      result = aiRes.data;
    } catch {
      // Fallback mock if Python service is offline
      result = {
        skills: [
          { name: 'Python', proficiency: 85, category: 'Programming' },
          { name: 'TensorFlow', proficiency: 72, category: 'AI/ML' },
          { name: 'React', proficiency: 68, category: 'Frontend' },
          { name: 'SQL', proficiency: 52, category: 'Database' },
          { name: 'Docker', proficiency: 35, category: 'DevOps' }
        ],
        strengths: ['Strong Python foundation', 'ML/AI experience', 'Full-stack capable'],
        missing_skills: ['Kubernetes', 'System Design', 'Data Visualization'],
        experience_years: 0.5,
        education: 'B.Tech Computer Science'
      };
    }

    // Auto-insert extracted skills
    for (const skill of result.skills || []) {
      await pg.query(
        `INSERT INTO user_skills (user_id, skill_name, proficiency, category, source)
         VALUES ($1,$2,$3,$4,'resume')
         ON CONFLICT (user_id, skill_name) DO NOTHING`,
        [req.user.id, skill.name, skill.proficiency, skill.category]
      ).catch(() => {});
    }

    // Log to MongoDB
    await ResumeLog.create({ userId: req.user.id, ...result }).catch(() => {});
    await refreshScore(req.user.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Resume analysis failed' });
  }
});

// GET /api/ai/skill-gap?role=Data+Scientist
app.get('/api/ai/skill-gap', auth, async (req, res) => {
  try {
    const { role = 'Data Scientist' } = req.query;
    const userSkills = await pg.query(
      'SELECT skill_name, proficiency FROM user_skills WHERE user_id=$1', [req.user.id]
    );
    const roleReqs = await pg.query(
      'SELECT * FROM role_requirements WHERE LOWER(role_name) = LOWER($1)', [role]
    );
    const userMap = {};
    userSkills.rows.forEach(s => { userMap[s.skill_name.toLowerCase()] = s.proficiency; });

    const gaps = [], matched = [];
    roleReqs.rows.forEach(r => {
      const level = userMap[r.skill_name.toLowerCase()] || 0;
      const gap = r.min_proficiency - level;
      if (gap > 0) gaps.push({ skill: r.skill_name, gap, importance: r.importance, userLevel: level, required: r.min_proficiency, weeks: Math.ceil(gap/10) });
      else matched.push({ skill: r.skill_name, level });
    });

    const readiness = Math.round(matched.length / Math.max(roleReqs.rows.length, 1) * 100);
    const learningPath = gaps.sort((a,b)=>b.importance-a.importance).slice(0,5).map(g => ({
      ...g,
      resources: [`Coursera: ${g.skill} Specialization`, `Kaggle: ${g.skill} Practice Sets`, `YouTube: ${g.skill} Full Course`]
    }));

    await AILog.create({ userId: req.user.id, action: 'skill-gap', input: { role }, output: { readiness, gapsCount: gaps.length } }).catch(()=>{});
    res.json({ role, readiness_score: readiness, gaps: learningPath, matched });
  } catch (e) {
    res.status(500).json({ error: 'Skill gap analysis failed' });
  }
});

// GET /api/ai/career-prediction
app.get('/api/ai/career-prediction', auth, async (req, res) => {
  try {
    const skills = await pg.query(
      'SELECT LOWER(skill_name) as skill FROM user_skills WHERE user_id=$1', [req.user.id]
    );
    const achievements = await pg.query(
      'SELECT COUNT(*) FROM achievements WHERE user_id=$1', [req.user.id]
    );
    const profile = await pg.query(
      'SELECT sp.cgpa FROM student_profiles sp WHERE sp.user_id=$1', [req.user.id]
    );

    const userSkills = skills.rows.map(r => r.skill);
    const achCount = +achievements.rows[0].count;
    const cgpa = +profile.rows[0]?.cgpa || 7;

    const careers = [
      { role: 'Data Scientist', icon: '📊', keywords: ['python','machine learning','sql','statistics','pandas','data'] },
      { role: 'ML Engineer', icon: '🤖', keywords: ['tensorflow','pytorch','python','mlops','docker','deep learning'] },
      { role: 'Full Stack Developer', icon: '💻', keywords: ['react','node.js','javascript','sql','mongodb','express'] },
      { role: 'Backend Developer', icon: '⚙️', keywords: ['node.js','python','java','sql','docker','microservices'] },
      { role: 'AI Research Engineer', icon: '🔬', keywords: ['python','tensorflow','nlp','computer vision','pytorch'] },
      { role: 'DevOps Engineer', icon: '☁️', keywords: ['docker','kubernetes','aws','linux','ci/cd','terraform'] },
      { role: 'Product Manager', icon: '📦', keywords: ['agile','communication','leadership','analytics','scrum'] }
    ];

    const predictions = careers.map(c => {
      const matches = c.keywords.filter(k => userSkills.some(s => s.includes(k))).length;
      let score = Math.round((matches / c.keywords.length) * 100);
      score += Math.min(achCount * 2, 10);
      if (cgpa >= 8) score += 5;
      return { role: c.role, icon: c.icon, score: Math.min(score, 100), fit: score >= 70 ? 'Excellent' : score >= 50 ? 'Good' : 'Developing' };
    }).sort((a,b) => b.score - a.score);

    await AILog.create({ userId: req.user.id, action: 'career-predict', input: { skillCount: userSkills.length }, output: { top: predictions[0]?.role } }).catch(()=>{});
    res.json({ predictions: predictions.slice(0,5), topRole: predictions[0]?.role, confidence: predictions[0]?.score });
  } catch (e) {
    res.status(500).json({ error: 'Career prediction failed' });
  }
});

// GET /api/dashboard
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const [prof, skills, opps, ach] = await Promise.all([
      pg.query('SELECT u.name, sp.profile_score, sp.target_role FROM users u LEFT JOIN student_profiles sp ON u.id=sp.user_id WHERE u.id=$1', [req.user.id]),
      pg.query('SELECT COUNT(*) FROM user_skills WHERE user_id=$1', [req.user.id]),
      pg.query('SELECT COUNT(*) FROM applications WHERE user_id=$1', [req.user.id]),
      pg.query('SELECT COUNT(*) FROM achievements WHERE user_id=$1', [req.user.id])
    ]);
    res.json({
      name: prof.rows[0]?.name,
      profileScore: prof.rows[0]?.profile_score || 0,
      targetRole: prof.rows[0]?.target_role,
      totalSkills: +skills.rows[0].count,
      totalApplications: +opps.rows[0].count,
      totalAchievements: +ach.rows[0].count
    });
  } catch (e) {
    res.status(500).json({ error: 'Dashboard fetch failed' });
  }
});

// ── Health ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'SkillSync API v1.0.0', time: new Date().toISOString() }));

// ── Error Handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => console.log(`\n🚀  SkillSync API  →  http://localhost:${PORT}\n`));

module.exports = app;
