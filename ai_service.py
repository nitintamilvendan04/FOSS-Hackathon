# ============================================================
#  SkillSync AI Service  (ai_service.py)
#  FastAPI + spaCy + scikit-learn + pdfplumber
#  Run: uvicorn ai_service:app --reload --port 8000
# ============================================================

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re, io, json

# Optional heavy deps — graceful fallback
try:
    import pdfplumber; PDF = True
except: PDF = False

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np; ML = True
except: ML = False

app = FastAPI(title="SkillSync AI", version="1.0.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Skill Taxonomy ───────────────────────────────────────────
SKILLS: Dict[str, List[str]] = {
  "Programming":  ["python","java","javascript","typescript","c++","c#","go","rust","kotlin","swift","ruby","php","r","matlab","bash"],
  "AI/ML":        ["machine learning","deep learning","neural networks","tensorflow","pytorch","keras","sklearn","nlp","natural language processing","computer vision","transformers","bert","gpt","llm","langchain","xgboost","pandas","numpy"],
  "Frontend":     ["react","next.js","vue","angular","html","css","tailwind","sass","redux","graphql","webpack","vite","typescript"],
  "Backend":      ["node.js","express","django","flask","fastapi","spring","laravel","rest api","graphql","microservices","grpc"],
  "Database":     ["sql","postgresql","mysql","mongodb","redis","elasticsearch","firebase","sqlite","dynamodb","cassandra"],
  "DevOps":       ["docker","kubernetes","aws","gcp","azure","ci/cd","jenkins","github actions","terraform","ansible","linux","nginx","helm"],
  "Data":         ["data analysis","data visualization","tableau","power bi","spark","hadoop","airflow","matplotlib","seaborn","plotly","excel"],
  "Soft Skills":  ["leadership","communication","teamwork","problem solving","agile","scrum","project management"],
}
FLAT = {s: cat for cat, sl in SKILLS.items() for s in sl}

ROLE_REQUIREMENTS = {
  "data scientist": [
    {"skill":"Python","required":85,"importance":10}, {"skill":"Machine Learning","required":80,"importance":10},
    {"skill":"SQL","required":75,"importance":8}, {"skill":"Statistics","required":70,"importance":9},
    {"skill":"Data Visualization","required":65,"importance":7}, {"skill":"Pandas","required":80,"importance":8}
  ],
  "ml engineer": [
    {"skill":"Python","required":90,"importance":10}, {"skill":"TensorFlow","required":80,"importance":10},
    {"skill":"PyTorch","required":70,"importance":9}, {"skill":"Docker","required":70,"importance":8},
    {"skill":"MLOps","required":65,"importance":7}
  ],
  "full stack developer": [
    {"skill":"React","required":80,"importance":10}, {"skill":"Node.js","required":80,"importance":10},
    {"skill":"JavaScript","required":85,"importance":10}, {"skill":"SQL","required":70,"importance":8},
    {"skill":"MongoDB","required":65,"importance":7}
  ],
  "backend developer": [
    {"skill":"Node.js","required":85,"importance":10}, {"skill":"SQL","required":80,"importance":9},
    {"skill":"Docker","required":70,"importance":8}, {"skill":"REST API","required":85,"importance":10}
  ],
  "devops engineer": [
    {"skill":"Docker","required":85,"importance":10}, {"skill":"Kubernetes","required":80,"importance":10},
    {"skill":"AWS","required":75,"importance":9}, {"skill":"Linux","required":80,"importance":9}, {"skill":"CI/CD","required":80,"importance":10}
  ]
}

# ── Helpers ─────────────────────────────────────────────────
def extract_text(data: bytes, filename: str) -> str:
    if filename.lower().endswith(".pdf") and PDF:
        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                return "\n".join(p.extract_text() or "" for p in pdf.pages)
        except: pass
    return data.decode("utf-8", errors="ignore")

def find_skills(text: str) -> List[Dict]:
    tl = text.lower()
    found = []
    for skill, cat in FLAT.items():
        if re.search(r'\b' + re.escape(skill) + r'\b', tl):
            found.append({"name": skill.title(), "category": cat, "proficiency": proficiency_from_context(tl, skill)})
    return found

def proficiency_from_context(text: str, skill: str) -> int:
    pos = text.find(skill)
    if pos < 0: return 65
    ctx = text[max(0,pos-120):pos+120]
    for kw in ["expert","advanced","proficient","strong","extensive","senior","lead"]:
        if kw in ctx: return 88
    for kw in ["intermediate","working","familiar","experience","used","built"]:
        if kw in ctx: return 72
    for kw in ["learning","beginner","basic","intro","course"]:
        if kw in ctx: return 48
    return 65

def extract_email(t): m = re.search(r'[\w.+-]+@[\w-]+\.[a-z]{2,}', t); return m.group() if m else None
def extract_phone(t): m = re.search(r'[\+\(]?[1-9][0-9 .\-\(\)]{8,}[0-9]', t); return m.group() if m else None
def extract_github(t): m = re.search(r'github\.com/([A-Za-z0-9\-_]+)', t); return f"https://github.com/{m.group(1)}" if m else None
def extract_exp(t):
    m = re.search(r'(\d+)\+?\s*years?\s*of\s*experience', t.lower())
    return float(m.group(1)) if m else round(len(re.findall(r'intern', t.lower())) * 0.5, 1)

def strengths(skills: List[Dict]) -> List[str]:
    names = {s["name"].lower() for s in skills}
    out = []
    if any(x in names for x in ["python","tensorflow","pytorch"]): out.append("Strong AI/ML engineering background")
    if any(x in names for x in ["react","node.js","javascript"]): out.append("Full-stack web development capable")
    if len([s for s in skills if s["category"]=="DevOps"]) >= 2: out.append("Cloud and DevOps experience")
    if len(skills) >= 8: out.append("Broad multi-domain skillset")
    return out or ["Technical foundation building"]

def missing(skills: List[Dict]) -> List[str]:
    must = ["docker","git","sql","linux","rest api","agile","communication"]
    have = {s["name"].lower() for s in skills}
    return [s for s in must if s not in have][:5]

# ════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════

@app.get("/health")
def health(): return {"status":"ok","service":"SkillSync AI","spacy":False,"ml":ML,"pdf":PDF}

@app.post("/analyze-resume")
async def analyze_resume(file: UploadFile = File(...)):
    data = await file.read()
    text = extract_text(data, file.filename)
    if not text.strip(): raise HTTPException(422, "Could not extract text from file")
    found_skills = find_skills(text)
    return {
        "skills": found_skills,
        "experience_years": extract_exp(text),
        "education": next((d.upper() for d in ["b.tech","m.tech","btech","bachelor","master","phd","bca","mca"] if d in text.lower()), "Not detected"),
        "contact": {"email": extract_email(text), "phone": extract_phone(text), "github": extract_github(text)},
        "strengths": strengths(found_skills),
        "missing_skills": missing(found_skills),
        "total_skills": len(found_skills),
        "raw_text": text[:300]
    }

class SkillGapReq(BaseModel):
    user_skills: List[Dict[str, Any]]
    target_role: str

@app.post("/skill-gap")
def skill_gap(req: SkillGapReq):
    reqs = ROLE_REQUIREMENTS.get(req.target_role.lower(), ROLE_REQUIREMENTS["data scientist"])
    umap = {s["name"].lower(): s.get("proficiency", 60) for s in req.user_skills}
    gaps, matched = [], []
    for r in reqs:
        level = umap.get(r["skill"].lower(), 0)
        gap = r["required"] - level
        if gap > 0:
            gaps.append({**r, "user_level": level, "gap": gap, "weeks": max(1, gap//10),
                         "resources": [f"Coursera: {r['skill']} Specialization", f"Kaggle: {r['skill']} Practice", "freeCodeCamp YouTube"]})
        else:
            matched.append({"skill": r["skill"], "level": level})
    readiness = round(len(matched) / max(len(reqs),1) * 100)
    return {"role": req.target_role, "readiness_score": readiness, "gaps": sorted(gaps,key=lambda x:-x["importance"]), "matched": matched}

class CareerReq(BaseModel):
    skills: List[str]
    cgpa: Optional[float] = 7.0
    achievements_count: Optional[int] = 0
    internship_count: Optional[int] = 0

@app.post("/career-prediction")
def predict_career(req: CareerReq):
    sl = [s.lower() for s in req.skills]
    profiles = [
        {"role":"Data Scientist","icon":"📊","keys":["python","machine learning","sql","statistics","pandas"]},
        {"role":"ML Engineer","icon":"🤖","keys":["tensorflow","pytorch","python","docker","mlops"]},
        {"role":"Full Stack Developer","icon":"💻","keys":["react","node.js","javascript","sql","mongodb"]},
        {"role":"Backend Developer","icon":"⚙️","keys":["node.js","python","java","sql","docker"]},
        {"role":"DevOps Engineer","icon":"☁️","keys":["docker","kubernetes","aws","linux","ci/cd"]},
        {"role":"AI Research Engineer","icon":"🔬","keys":["python","tensorflow","nlp","computer vision","pytorch"]},
        {"role":"Product Manager","icon":"📦","keys":["agile","communication","leadership","analytics","scrum"]},
    ]
    results = []
    for p in profiles:
        matches = sum(1 for k in p["keys"] if any(k in s for s in sl))
        score = int(matches/len(p["keys"])*100) + min(req.achievements_count*2,10) + min(req.internship_count*5,15) + (5 if (req.cgpa or 7) >= 8 else 0)
        results.append({"role":p["role"],"icon":p["icon"],"score":min(score,100),"fit":"Excellent" if score>=70 else "Good" if score>=50 else "Developing"})
    results.sort(key=lambda x:-x["score"])
    return {"predictions":results[:5],"top_role":results[0]["role"],"confidence":results[0]["score"]}

class OppMatchReq(BaseModel):
    user_skills: List[str]
    opportunities: List[Dict[str, Any]]

@app.post("/match-opportunities")
def match_opps(req: OppMatchReq):
    user_text = " ".join(req.user_skills)
    if ML and len(req.opportunities) > 0:
        docs = [user_text] + [" ".join(o.get("required_skills",[])) for o in req.opportunities]
        try:
            tfidf = TfidfVectorizer()
            mat = tfidf.fit_transform(docs)
            sims = cosine_similarity(mat[0:1], mat[1:])[0]
            for i, opp in enumerate(req.opportunities):
                opp["match_score"] = round(float(sims[i]) * 100, 1)
        except:
            _fallback_match(req.user_skills, req.opportunities)
    else:
        _fallback_match(req.user_skills, req.opportunities)
    return sorted(req.opportunities, key=lambda x: x.get("match_score",0), reverse=True)

def _fallback_match(user_skills, opps):
    us = set(s.lower() for s in user_skills)
    for opp in opps:
        rs = set(s.lower() for s in opp.get("required_skills",[]))
        opp["match_score"] = round(len(us & rs)/max(len(rs),1)*100)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ai_service:app", host="0.0.0.0", port=8000, reload=True)
