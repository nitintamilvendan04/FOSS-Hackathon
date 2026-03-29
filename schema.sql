-- ============================================================
--  SkillSync Database Schema
--  PostgreSQL 15+
--  Run: psql -U postgres -d skillsync -f schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    college         VARCHAR(200),
    branch          VARCHAR(100),
    year            SMALLINT DEFAULT 1 CHECK (year BETWEEN 1 AND 5),
    github_url      VARCHAR(500),
    linkedin_url    VARCHAR(500),
    avatar_url      VARCHAR(500),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── STUDENT PROFILES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_profiles (
    id              SERIAL PRIMARY KEY,
    user_id         INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bio             TEXT,
    location        VARCHAR(200),
    target_role     VARCHAR(100),
    profile_score   SMALLINT DEFAULT 0 CHECK (profile_score BETWEEN 0 AND 100),
    resume_url      VARCHAR(500),
    portfolio_url   VARCHAR(500),
    cgpa            DECIMAL(4,2),
    graduation_year SMALLINT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── USER SKILLS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_skills (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_name      VARCHAR(100) NOT NULL,
    proficiency     SMALLINT DEFAULT 50 CHECK (proficiency BETWEEN 0 AND 100),
    category        VARCHAR(50) DEFAULT 'Technical',
    source          VARCHAR(20) DEFAULT 'manual',   -- manual | resume | github
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON user_skills(LOWER(skill_name));

-- ── ACHIEVEMENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    type            VARCHAR(50) NOT NULL,   -- internship | hackathon | certification | project | course | award
    description     TEXT,
    organization    VARCHAR(200),
    date            DATE,
    end_date        DATE,
    certificate_url VARCHAR(500),
    skills_used     TEXT[] DEFAULT '{}',
    is_featured     BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ach_user ON achievements(user_id);

-- ── PROJECTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    tech_stack      TEXT[] DEFAULT '{}',
    github_url      VARCHAR(500),
    live_url        VARCHAR(500),
    thumbnail_url   VARCHAR(500),
    start_date      DATE,
    end_date        DATE,
    is_featured     BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── OPPORTUNITIES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunities (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(300) NOT NULL,
    company         VARCHAR(200),
    type            VARCHAR(50) NOT NULL,   -- job | internship | hackathon | scholarship | research | course
    description     TEXT,
    location        VARCHAR(200),
    is_remote       BOOLEAN DEFAULT FALSE,
    stipend_min     INT,
    stipend_max     INT,
    stipend_currency VARCHAR(10) DEFAULT 'INR',
    prize_amount    INT,
    apply_url       VARCHAR(1000) NOT NULL,
    deadline        DATE,
    duration        VARCHAR(100),
    eligibility     TEXT,
    source          VARCHAR(100),
    source_id       VARCHAR(200),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_opp_type   ON opportunities(type);
CREATE INDEX IF NOT EXISTS idx_opp_active ON opportunities(is_active);
CREATE INDEX IF NOT EXISTS idx_opp_search ON opportunities USING gin(to_tsvector('english', title));

-- ── OPPORTUNITY SKILLS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunity_skills (
    opportunity_id  INT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    skill_name      VARCHAR(100) NOT NULL,
    is_required     BOOLEAN DEFAULT TRUE,
    PRIMARY KEY(opportunity_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_opp_skills ON opportunity_skills(LOWER(skill_name));

-- ── APPLICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id  INT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    status          VARCHAR(30) DEFAULT 'applied',   -- saved | applied | interviewed | offered | rejected
    applied_at      TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT,
    UNIQUE(user_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id);

-- ── ROLE REQUIREMENTS (for Skill Gap Analysis) ───────────────
CREATE TABLE IF NOT EXISTS role_requirements (
    id              SERIAL PRIMARY KEY,
    role_name       VARCHAR(100) NOT NULL,
    skill_name      VARCHAR(100) NOT NULL,
    min_proficiency SMALLINT DEFAULT 60,
    importance      SMALLINT DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    UNIQUE(role_name, skill_name)
);

-- Seed role requirements
INSERT INTO role_requirements (role_name, skill_name, min_proficiency, importance) VALUES
('Data Scientist','Python',85,10),('Data Scientist','Machine Learning',80,10),
('Data Scientist','SQL',75,8),('Data Scientist','Statistics',70,9),
('Data Scientist','Data Visualization',65,7),('Data Scientist','Pandas',80,8),
('Data Scientist','TensorFlow',60,6),
('ML Engineer','Python',90,10),('ML Engineer','TensorFlow',80,10),
('ML Engineer','PyTorch',70,9),('ML Engineer','Docker',70,8),('ML Engineer','SQL',65,6),
('Full Stack Developer','React',80,10),('Full Stack Developer','Node.js',80,10),
('Full Stack Developer','JavaScript',85,10),('Full Stack Developer','SQL',70,8),
('Full Stack Developer','MongoDB',65,7),('Full Stack Developer','Docker',60,6),
('Backend Developer','Node.js',85,10),('Backend Developer','SQL',80,9),
('Backend Developer','Docker',70,8),('Backend Developer','REST API',85,10),
('DevOps Engineer','Docker',85,10),('DevOps Engineer','Kubernetes',80,10),
('DevOps Engineer','AWS',75,9),('DevOps Engineer','Linux',80,9),('DevOps Engineer','CI/CD',80,10)
ON CONFLICT (role_name, skill_name) DO NOTHING;

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,   -- opportunity | skill_gap | achievement | system
    title           VARCHAR(200) NOT NULL,
    message         TEXT,
    link            VARCHAR(500),
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif ON notifications(user_id, is_read);

-- ── PROFILE SCORE HISTORY ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_score_history (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score       SMALLINT NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_score_hist ON profile_score_history(user_id, recorded_at DESC);

-- ── COURSES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(300) NOT NULL,
    platform        VARCHAR(100),
    skills_covered  TEXT[] DEFAULT '{}',
    completion_date DATE,
    certificate_url VARCHAR(500),
    duration_hours  INT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── COMPANY TARGETS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_targets (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name    VARCHAR(200) NOT NULL,
    company_type    VARCHAR(50),   -- product | service | startup | research
    target_role     VARCHAR(100),
    probability     SMALLINT,
    status          VARCHAR(30) DEFAULT 'targeting',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUTO-UPDATE TIMESTAMPS ────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DO $$ BEGIN
  CREATE TRIGGER t_users_upd    BEFORE UPDATE ON users             FOR EACH ROW EXECUTE FUNCTION trg_updated_at();
  CREATE TRIGGER t_profile_upd  BEFORE UPDATE ON student_profiles  FOR EACH ROW EXECUTE FUNCTION trg_updated_at();
  CREATE TRIGGER t_skills_upd   BEFORE UPDATE ON user_skills        FOR EACH ROW EXECUTE FUNCTION trg_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

-- ── SEED OPPORTUNITIES ────────────────────────────────────────
INSERT INTO opportunities (title,company,type,location,is_remote,stipend_min,stipend_max,apply_url,deadline,duration,source,source_id,is_active) VALUES
('AI Research Intern','Google DeepMind','internship','Bangalore',FALSE,40000,50000,'https://careers.google.com','2026-06-30','6 months','seed','s001',TRUE),
('Full Stack Developer Intern','Flipkart','internship','Bangalore',FALSE,25000,35000,'https://careers.flipkart.com','2026-05-31','3 months','seed','s002',TRUE),
('Smart India Hackathon 2026','Govt of India','hackathon','Pan India',TRUE,NULL,NULL,'https://sih.gov.in','2026-04-15','48 hours','seed','s003',TRUE),
('ML Engineer','Zepto AI','job','Mumbai',TRUE,80000,120000,'https://zepto.com/careers','2026-07-31','Full Time','seed','s004',TRUE),
('Data Science Bootcamp','Coursera','course','Online',TRUE,NULL,NULL,'https://coursera.org',NULL,'8 weeks','seed','s005',TRUE),
('Research Fellowship','IISc Bangalore','research','Bangalore',FALSE,25000,30000,'https://iisc.ac.in','2026-05-01','1 year','seed','s006',TRUE),
('Backend Engineer Intern','Razorpay','internship','Bangalore',TRUE,35000,45000,'https://razorpay.com/jobs','2026-06-15','6 months','seed','s007',TRUE)
ON CONFLICT (source, source_id) DO NOTHING;

INSERT INTO opportunity_skills (opportunity_id, skill_name, is_required)
SELECT o.id, s.skill, s.req FROM opportunities o
JOIN (VALUES
  ('s001','Python',TRUE),('s001','Machine Learning',TRUE),('s001','TensorFlow',TRUE),('s001','NLP',FALSE),
  ('s002','React',TRUE),('s002','Node.js',TRUE),('s002','JavaScript',TRUE),('s002','SQL',FALSE),
  ('s003','Python',FALSE),('s003','Machine Learning',FALSE),('s003','React',FALSE),
  ('s004','Python',TRUE),('s004','TensorFlow',TRUE),('s004','Docker',TRUE),('s004','MLOps',FALSE),
  ('s005','Python',FALSE),('s005','Machine Learning',FALSE),('s005','SQL',FALSE),
  ('s006','Python',TRUE),('s006','Research',FALSE),('s006','Statistics',TRUE),
  ('s007','Node.js',TRUE),('s007','SQL',TRUE),('s007','Docker',FALSE),('s007','REST API',TRUE)
) AS s(src_id, skill, req) ON o.source_id = s.src_id
ON CONFLICT DO NOTHING;

-- ── VIEWS ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW student_summary AS
SELECT u.id, u.name, u.email, u.college, u.branch, u.year,
       sp.profile_score, sp.target_role,
       COUNT(DISTINCT us.id) AS total_skills,
       COUNT(DISTINCT a.id) AS total_achievements,
       COUNT(DISTINCT p.id) AS total_projects,
       COUNT(DISTINCT app.id) AS total_applications
FROM users u
LEFT JOIN student_profiles sp ON u.id = sp.user_id
LEFT JOIN user_skills us ON u.id = us.user_id
LEFT JOIN achievements a ON u.id = a.user_id
LEFT JOIN projects p ON u.id = p.user_id
LEFT JOIN applications app ON u.id = app.user_id
GROUP BY u.id, sp.profile_score, sp.target_role;
