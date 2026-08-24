require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "boss-tn-dev-secret";
const EMPTY = () => Array.from({ length: 11 }, () => 0);
const emptyWeeks = () => Array.from({ length: 5 }, EMPTY);
const POINT_KEYS = ["attendance","oneToOne","referral","payment","business","visitor","power","induction","late","better","discipline"];
function defaultPoints() {
  return {
    attendance: 100, oneToOne: 100, referral: 100, payment: 200, business: 200,
    visitor: 200, power: 500, induction: 500, late: -100, better: -200, discipline: -200
  };
}
function mergePoints(stored) {
  const out = defaultPoints();
  if (stored && typeof stored === "object") {
    POINT_KEYS.forEach(k => {
      const n = Number(stored[k]);
      if (Number.isFinite(n)) out[k] = n;
    });
  }
  return out;
}
function normEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "";
  return s;
}

const { Schema } = mongoose;

const Chapter = mongoose.model("Chapter", new Schema({
  name: { type: String, required: true },
  city: { type: String, default: "" },
  state: { type: String, default: "" },
  meetingDay: { type: Number, default: 2 },
  activityPoints: { type: Schema.Types.Mixed, default: defaultPoints }
}, { timestamps: true }));

const User = mongoose.model("User", new Schema({
  chapterId: { type: Schema.Types.ObjectId, ref: "Chapter", default: null },
  role: { type: String, enum: ["platform", "president", "captain", "member"], required: true },
  name: { type: String, default: "" },
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null }
}, { timestamps: true }));

const Team = mongoose.model("Team", new Schema({
  chapterId: { type: Schema.Types.ObjectId, ref: "Chapter", required: true },
  name: { type: String, required: true },
  businessName: { type: String, default: "" },
  captainUserId: { type: Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true }));

const Member = mongoose.model("Member", new Schema({
  chapterId: { type: Schema.Types.ObjectId, required: true },
  teamId: { type: Schema.Types.ObjectId, required: true },
  name: { type: String, required: true },
  businessName: { type: String, default: "" },
  photo: { type: String, default: "" },
  website: { type: String, default: "" },
  social: { type: String, default: "" },
  location: { type: String, default: "" }
}, { timestamps: true }));

const Score = mongoose.model("Score", new Schema({
  chapterId: { type: Schema.Types.ObjectId, required: true },
  teamId: { type: Schema.Types.ObjectId, required: true },
  memberId: { type: Schema.Types.ObjectId, required: true },
  month: { type: String, required: true },
  weeks: { type: [[Number]], default: emptyWeeks }
}, { timestamps: true }));

const Report = mongoose.model("Report", new Schema({
  chapterId: { type: Schema.Types.ObjectId, required: true },
  title: String,
  type: String,
  month: String,
  week: Number,
  teamIds: [String],
  html: String,
  createdAt: { type: Date, default: Date.now }
}));

function sign(user, extra = {}) {
  return jwt.sign({
    userId: String(user._id),
    role: user.role,
    name: user.name || user.email || "",
    email: user.email || "",
    chapterId: user.chapterId ? String(user.chapterId) : null,
    teamId: user.teamId ? String(user.teamId) : null,
    memberId: extra.memberId || null
  }, JWT_SECRET, { expiresIn: "14d" });
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sign in required" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Session expired. Sign in again." }); }
}

function isPresident(u) { return u.role === "president"; }
function isPlatform(u) { return u.role === "platform"; }
function isCaptain(u) { return u.role === "captain"; }

function actingChapterId(req) {
  if (isPlatform(req.user)) {
    return req.headers["x-chapter-id"] || req.query.chapterId || (req.body && req.body.chapterId) || null;
  }
  return req.user.chapterId || null;
}

function isChapterAdmin(user, chapterId) {
  if (!chapterId) return false;
  if (isPlatform(user)) return true;
  return isPresident(user) && String(user.chapterId) === String(chapterId);
}

function canSeeTeam(user, team) {
  if (!team) return false;
  if (isPlatform(user)) return true;
  if (String(team.chapterId) !== String(user.chapterId)) return false;
  if (isPresident(user)) return true;
  if (isCaptain(user) && String(user.teamId) === String(team._id)) return true;
  if (user.role === "member" && String(user.teamId) === String(team._id)) return true;
  return false;
}

function canEditTeam(user, team) {
  if (!team) return false;
  if (isPlatform(user)) return true;
  if (isPresident(user) && String(team.chapterId) === String(user.chapterId)) return true;
  if (isCaptain(user) && String(user.teamId) === String(team._id)) return true;
  return false;
}

function canEditScores(user, team) {
  if (!team) return false;
  if (isPlatform(user) || (isPresident(user) && String(team.chapterId) === String(user.chapterId))) return true;
  if (isCaptain(user) && String(user.teamId) === String(team._id)) return true;
  return false;
}

function visibleTeamFilter(user, chapterId) {
  if (isPlatform(user)) return chapterId ? { chapterId } : { _id: null };
  if (isPresident(user)) return { chapterId: user.chapterId };
  return { chapterId: user.chapterId, _id: user.teamId };
}

function id(x) { return String(x); }

async function seed() {
  const superName = process.env.PLATFORM_NAME || "Bhushan";
  const superEmail = String(process.env.PLATFORM_EMAIL || "bhushan@bossreports.local").trim().toLowerCase();

  const missingEmail = await User.find({ $or: [{ email: { $exists: false } }, { email: null }, { email: "" }] });
  for (const u of missingEmail) {
    u.email = u.role === "platform" ? superEmail : `${u.role}.${u._id}@pending.local`;
    if (!u.name) u.name = u.email;
    await u.save();
  }

  let platform = await User.findOne({ role: "platform" });
  if (!platform) {
    platform = await User.create({
      role: "platform",
      name: superName,
      email: superEmail,
      passwordHash: await bcrypt.hash(process.env.PLATFORM_PASSWORD || "bhushan123", 10)
    });
    console.log("Seeded super admin:", platform.name);
  } else {
    if (platform.name !== superName) platform.name = superName;
    if (process.env.PLATFORM_EMAIL) platform.email = superEmail;
    else if (!platform.email) platform.email = superEmail;
    await platform.save();
  }
  console.log("Super admin login name:", platform.name);

  const chapters = await Chapter.find({});
  for (const c of chapters) {
    let changed = false;
    if (c.name === "BOSS Agro Hub" && !c.state) { c.state = "Tamil Nadu"; changed = true; }
    const merged = mergePoints(c.activityPoints);
    if (JSON.stringify(c.activityPoints || {}) !== JSON.stringify(merged)) {
      c.activityPoints = merged;
      changed = true;
    }
    if (changed) await c.save();
  }

  let chapter = await Chapter.findOne({ name: "BOSS Agro Hub" });
  if (!chapter) {
    chapter = await Chapter.create({
      name: "BOSS Agro Hub", city: "Udumalpet", state: "Tamil Nadu",
      meetingDay: 2, activityPoints: defaultPoints()
    });
    await User.create({
      chapterId: chapter._id,
      role: "president",
      name: "",
      email: "president.agrohub@pending.local",
      passwordHash: await bcrypt.hash("admin123", 10)
    });
    console.log("Seeded chapter BOSS Agro Hub / Udumalpet / Tamil Nadu");
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "..")));

app.get("/api/health", (_req, res) => res.json({ ok: true, db: "boss_tn" }));

app.get("/api/auth/chapters", async (_req, res) => {
  const chapters = await Chapter.find({}).sort({ city: 1, name: 1 }).lean();
  res.json(chapters.map(c => ({ id: id(c._id), name: c.name, city: c.city || "", state: c.state || "" })));
});

app.get("/api/auth/people", async (req, res) => {
  const { role } = req.query;
  if (role !== "platform") return res.status(400).json({ error: "Only super admin names are listed" });
  const users = await User.find({ role: "platform" }).select("name").lean();
  res.json(users.map(u => ({ name: u.name })));
});

app.post("/api/auth/login", async (req, res) => {
  const { chapterId, role, name, password } = req.body || {};
  const email = normEmail(req.body && req.body.email);
  if (!role || !password) return res.status(400).json({ error: "Role and password required" });
  if (role === "member") return res.status(403).json({ error: "Members do not sign in. Ask your team captain to enter details and scores." });

  let user = null;
  if (role === "platform") {
    if (!name) return res.status(400).json({ error: "Name and password required" });
    user = await User.findOne({ role: "platform", name });
    if (!user) return res.status(401).json({ error: "No account with that name for this role" });
  } else {
    if (!email || !chapterId) return res.status(400).json({ error: "Chapter, email and password required" });
    user = await User.findOne({ role, email, chapterId });
    if (!user) return res.status(401).json({ error: "No account with that email for this chapter and role" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Wrong password" });
  if (user.role === "captain" && !user.teamId) return res.status(401).json({ error: "This captain is not assigned to a team yet" });
  const token = sign(user);
  res.json({
    token,
    user: {
      id: id(user._id),
      name: user.name || user.email,
      email: user.email || "",
      role: user.role,
      chapterId: user.chapterId ? id(user.chapterId) : null,
      teamId: user.teamId ? id(user.teamId) : null,
      memberId: null
    }
  });
});

app.get("/api/state", auth, async (req, res) => {
  const month = String(req.query.month || "").slice(0, 7);
  if (!month) return res.status(400).json({ error: "month required" });
  const u = req.user;
  const chapterId = actingChapterId(req);

  if (isPlatform(u) && !chapterId) {
    const chapters = await Chapter.find({}).sort({ city: 1, name: 1 }).lean();
    const teamCounts = await Team.aggregate([{ $group: { _id: "$chapterId", n: { $sum: 1 } } }]);
    const memberCounts = await Member.aggregate([{ $group: { _id: "$chapterId", n: { $sum: 1 } } }]);
    const tMap = Object.fromEntries(teamCounts.map(x => [id(x._id), x.n]));
    const mMap = Object.fromEntries(memberCounts.map(x => [id(x._id), x.n]));
    const presidents = await User.find({ role: "president" }).select("email name chapterId").lean();
    const pMap = Object.fromEntries(presidents.map(p => [id(p.chapterId), p.email || p.name || ""]));
    return res.json({
      role: "platform",
      chapters: chapters.map(c => ({
        id: id(c._id), name: c.name, city: c.city || "", state: c.state || "", meetingDay: c.meetingDay,
        presidentEmail: pMap[id(c._id)] || "",
        teams: tMap[id(c._id)] || 0, members: mMap[id(c._id)] || 0
      })),
      chapter: null, teams: [], scores: {}, reports: [], captains: []
    });
  }

  const chapter = await Chapter.findById(chapterId).lean();
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  if (!isPlatform(u) && id(chapter._id) !== u.chapterId) return res.status(403).json({ error: "Not allowed" });

  const teamQ = visibleTeamFilter(u, id(chapter._id));
  const teams = await Team.find(teamQ).sort({ name: 1 }).lean();
  const teamIds = teams.map(t => t._id);
  const members = await Member.find({ teamId: { $in: teamIds } }).sort({ name: 1 }).lean();
  const scores = await Score.find({ month, teamId: { $in: teamIds } }).lean();

  const membersByTeam = {};
  members.forEach(m => {
    const k = id(m.teamId);
    (membersByTeam[k] ||= []).push({
      id: id(m._id), name: m.name, businessName: m.businessName || "", photo: m.photo || "",
      website: m.website || "", social: m.social || "", location: m.location || ""
    });
  });

  const scoreMap = {};
  scores.forEach(s => {
    const tid = id(s.teamId), mid = id(s.memberId);
    (scoreMap[tid] ||= {})[mid] = (s.weeks || emptyWeeks()).map(row => {
      const r = (row || []).map(Number);
      while (r.length < 11) r.push(0);
      return r.slice(0, 11);
    });
    while (scoreMap[tid][mid].length < 5) scoreMap[tid][mid].push(EMPTY());
  });

  const presidentUser = await User.findOne({ chapterId: chapter._id, role: "president" }).lean();

  const captainUsers = isChapterAdmin(u, id(chapter._id))
    ? await User.find({ chapterId: chapter._id, role: "captain" }).lean()
    : [];

  const reports = await Report.find({ chapterId: chapter._id }).sort({ createdAt: -1 }).limit(40).lean();

  res.json({
    role: u.role,
    userId: u.userId,
    teamId: u.teamId,
    chapter: {
      id: id(chapter._id), name: chapter.name, city: chapter.city || "", state: chapter.state || "",
      meetingDay: chapter.meetingDay, activityPoints: mergePoints(chapter.activityPoints),
      presidentEmail: presidentUser ? (presidentUser.email || "") : ""
    },
    teams: teams.map(t => ({
      id: id(t._id),
      name: t.name,
      businessName: t.businessName || "",
      captainUserId: t.captainUserId ? id(t.captainUserId) : null,
      members: membersByTeam[id(t._id)] || []
    })),
    scores: scoreMap,
    captains: captainUsers.map(c => ({ id: id(c._id), email: c.email || "", name: c.name || c.email || "", teamId: c.teamId ? id(c.teamId) : null })),
    reports: reports.map(r => ({
      id: id(r._id), title: r.title, type: r.type, month: r.month, week: r.week,
      teamIds: r.teamIds, html: r.html, createdAt: r.createdAt
    }))
  });
});

app.post("/api/chapters", auth, async (req, res) => {
  if (!isPlatform(req.user)) return res.status(403).json({ error: "Only the super admin can create chapters" });
  const { name, city, state, meetingDay } = req.body || {};
  if (!name) return res.status(400).json({ error: "Chapter name required" });
  const chapter = await Chapter.create({
    name: String(name).trim(),
    city: String(city || "").trim(),
    state: String(state || "").trim(),
    meetingDay: Number(meetingDay ?? 2),
    activityPoints: defaultPoints()
  });
  res.json({ id: id(chapter._id), name: chapter.name, city: chapter.city, state: chapter.state });
});

app.patch("/api/chapters/:id", auth, async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) return res.status(404).json({ error: "Not found" });
  const u = req.user;
  if (!isPlatform(u) && !(isPresident(u) && id(chapter._id) === u.chapterId)) return res.status(403).json({ error: "Not allowed" });
  const { name, city, state, meetingDay, activityPoints } = req.body || {};
  if (name != null) chapter.name = String(name).trim();
  if (city != null) chapter.city = String(city).trim();
  if (state != null) chapter.state = String(state).trim();
  if (meetingDay != null) chapter.meetingDay = Number(meetingDay);
  if (activityPoints != null) chapter.activityPoints = mergePoints(activityPoints);
  await chapter.save();
  res.json({ ok: true, activityPoints: mergePoints(chapter.activityPoints) });
});

app.patch("/api/me/password", auth, async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(404).json({ error: "Not found" });
  user.passwordHash = await bcrypt.hash(String(password), 10);
  await user.save();
  res.json({ ok: true });
});

app.post("/api/teams", auth, async (req, res) => {
  const chapterId = actingChapterId(req);
  if (!isChapterAdmin(req.user, chapterId)) return res.status(403).json({ error: "Only the super admin or president can add teams" });
  const { name, businessName } = req.body || {};
  if (!name) return res.status(400).json({ error: "Team name required" });
  const team = await Team.create({
    chapterId,
    name: String(name).trim(),
    businessName: String(businessName || "").trim()
  });
  res.json({ id: id(team._id), name: team.name, businessName: team.businessName, members: [], captainUserId: null });
});

app.patch("/api/teams/:id", auth, async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team || !canSeeTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  if (!canEditTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  const { name, businessName } = req.body || {};
  if (name != null) team.name = String(name).trim();
  if (businessName != null) team.businessName = String(businessName).trim();
  await team.save();
  res.json({ ok: true });
});

app.delete("/api/teams/:id", auth, async (req, res) => {
  const chapterId = actingChapterId(req);
  if (!isChapterAdmin(req.user, chapterId)) return res.status(403).json({ error: "Only the super admin or president can delete teams" });
  const team = await Team.findOne({ _id: req.params.id, chapterId });
  if (!team) return res.status(404).json({ error: "Not found" });
  const count = await Team.countDocuments({ chapterId });
  if (count <= 1) return res.status(400).json({ error: "Cannot delete the last team" });
  await Member.deleteMany({ teamId: team._id });
  await Score.deleteMany({ teamId: team._id });
  await User.updateMany({ teamId: team._id }, { $set: { teamId: null } });
  await team.deleteOne();
  res.json({ ok: true });
});

app.post("/api/users/president", auth, async (req, res) => {
  if (!isPlatform(req.user)) return res.status(403).json({ error: "Only the super admin can create or replace a chapter president" });
  const chapterId = actingChapterId(req) || req.body.chapterId;
  const email = normEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!chapterId) return res.status(400).json({ error: "Open a chapter first" });
  if (!email) return res.status(400).json({ error: "President email required" });
  const chapter = await Chapter.findById(chapterId);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  let user = await User.findOne({ chapterId: chapter._id, role: "president" });
  const taken = await User.findOne({ email });
  if (taken && (!user || id(taken._id) !== id(user._id))) {
    return res.status(400).json({ error: "That email is already used by another account" });
  }
  if (!user && (!password || String(password).length < 4)) {
    return res.status(400).json({ error: "Password must be at least 4 characters to create a president" });
  }
  if (password && String(password).length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  if (user) {
    user.email = email;
    if (password) user.passwordHash = await bcrypt.hash(String(password), 10);
    await user.save();
  } else {
    user = await User.create({
      chapterId: chapter._id,
      role: "president",
      email,
      name: "",
      passwordHash: await bcrypt.hash(String(password), 10)
    });
  }
  res.json({ id: id(user._id), email: user.email });
});

app.post("/api/users/captain", auth, async (req, res) => {
  const chapterId = actingChapterId(req);
  if (!isChapterAdmin(req.user, chapterId)) return res.status(403).json({ error: "Only the super admin or president can create team captains" });
  const { password, teamId } = req.body || {};
  const email = normEmail(req.body && req.body.email);
  if (!email || !teamId) return res.status(400).json({ error: "Captain email and team required" });
  const team = await Team.findOne({ _id: teamId, chapterId });
  if (!team) return res.status(404).json({ error: "Team not found" });
  let user = await User.findOne({ email });
  if (user && user.role !== "captain") {
    return res.status(400).json({ error: "That email is already used by another role" });
  }
  if (user && user.chapterId && id(user.chapterId) !== id(chapterId)) {
    return res.status(400).json({ error: "That email belongs to another chapter" });
  }
  if (!user && (!password || String(password).length < 4)) {
    return res.status(400).json({ error: "Password must be at least 4 characters to create a captain" });
  }
  if (password && String(password).length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  if (user) {
    user.teamId = team._id;
    user.chapterId = team.chapterId;
    if (password) user.passwordHash = await bcrypt.hash(String(password), 10);
    await user.save();
  } else {
    user = await User.create({
      chapterId: team.chapterId,
      role: "captain",
      email,
      name: "",
      passwordHash: await bcrypt.hash(String(password), 10),
      teamId: team._id
    });
  }
  if (team.captainUserId && id(team.captainUserId) !== id(user._id)) {
    const prev = await User.findById(team.captainUserId);
    if (prev && prev.role === "captain") { prev.teamId = null; await prev.save(); }
  }
  team.captainUserId = user._id;
  await team.save();
  res.json({ id: id(user._id), email: user.email, teamId: id(team._id) });
});

app.post("/api/teams/:id/members", auth, async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team || !canSeeTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  if (!canEditTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  const { name, businessName, website, social, location, photo } = req.body || {};
  const memberName = String(name || "New member").trim();
  const member = await Member.create({
    chapterId: team.chapterId,
    teamId: team._id,
    name: memberName,
    businessName: String(businessName || "").trim(),
    website: String(website || "").trim(),
    social: String(social || "").trim(),
    location: String(location || "").trim(),
    photo: String(photo || "")
  });
  res.json({
    id: id(member._id), name: member.name, businessName: member.businessName,
    website: member.website, social: member.social, location: member.location, photo: member.photo
  });
});

app.patch("/api/members/:id", auth, async (req, res) => {
  const member = await Member.findById(req.params.id);
  if (!member) return res.status(404).json({ error: "Not found" });
  const team = await Team.findById(member.teamId);
  if (!canSeeTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  if (!(isPlatform(req.user) || isPresident(req.user) || isCaptain(req.user))) return res.status(403).json({ error: "Not allowed" });
  ["name", "businessName", "website", "social", "location", "photo"].forEach(k => {
    if (req.body[k] != null) member[k] = req.body[k];
  });
  await member.save();
  res.json({ ok: true });
});

app.delete("/api/members/:id", auth, async (req, res) => {
  const member = await Member.findById(req.params.id);
  if (!member) return res.status(404).json({ error: "Not found" });
  const team = await Team.findById(member.teamId);
  if (!canSeeTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  if (!canEditTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  await Score.deleteMany({ memberId: member._id });
  await User.deleteMany({ chapterId: member.chapterId, role: "member", name: member.name, teamId: member.teamId });
  await member.deleteOne();
  res.json({ ok: true });
});

app.put("/api/scores", auth, async (req, res) => {
  const { teamId, memberId, month, weeks } = req.body || {};
  if (!teamId || !memberId || !month) return res.status(400).json({ error: "team, member and month required" });
  const team = await Team.findById(teamId);
  if (!team || !canSeeTeam(req.user, team)) return res.status(403).json({ error: "Not allowed" });
  if (!canEditScores(req.user, team)) return res.status(403).json({ error: "Only super admin, president or captain can enter scores" });
  const member = await Member.findOne({ _id: memberId, teamId: team._id });
  if (!member) return res.status(404).json({ error: "Member not found" });
  const cleaned = Array.from({ length: 5 }, (_, w) => {
    const row = (weeks && weeks[w]) ? weeks[w].map(n => Math.max(0, Number(n) || 0)) : EMPTY();
    while (row.length < 11) row.push(0);
    return row.slice(0, 11);
  });
  await Score.findOneAndUpdate(
    { memberId: member._id, month },
    { chapterId: team.chapterId, teamId: team._id, memberId: member._id, month, weeks: cleaned },
    { upsert: true, new: true }
  );
  res.json({ ok: true });
});

app.post("/api/reports", auth, async (req, res) => {
  const chapterId = actingChapterId(req);
  if (!chapterId) return res.status(403).json({ error: "Not allowed" });
  const { title, type, month, week, teamIds, html } = req.body || {};
  const rec = await Report.create({
    chapterId,
    title: title || "Report",
    type, month, week, teamIds: teamIds || [], html: html || ""
  });
  res.json({ id: id(rec._id), title: rec.title, createdAt: rec.createdAt, type: rec.type, month: rec.month, week: rec.week, teamIds: rec.teamIds, html: rec.html });
});

app.delete("/api/reports/:id", auth, async (req, res) => {
  const chapterId = actingChapterId(req);
  const rec = await Report.findOne({ _id: req.params.id, chapterId });
  if (!rec) return res.status(404).json({ error: "Not found" });
  await rec.deleteOne();
  res.json({ ok: true });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log("Connected to MongoDB database boss_tn");
  await seed();
  app.listen(PORT, () => console.log("BOSS API on http://localhost:" + PORT));
}).catch(err => {
  console.error("MongoDB connection failed:", err.message);
  process.exit(1);
});
