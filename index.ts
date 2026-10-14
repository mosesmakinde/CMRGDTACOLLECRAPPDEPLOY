import { router, json, error, db, storage, requireAuth, withScopes } from '@appdeploy/sdk';

type Question = { id: string; label: string; type: string; required?: boolean; options?: string[] };
type Project = { id: string; title: string; description?: string; accessCode: string; questions: Question[]; createdAt: string };
type StaffRole = 'Administrator' | 'Research Manager' | 'Supervisor' | 'Situation Room Officer' | 'Interviewer';
type Staff = { userId: string; email: string; name?: string; role: StaffRole; active: boolean; createdAt: string };
type StaffInvite = { email: string; role: StaffRole; projectIds: string[]; active: boolean; invitedBy: string; invitedAt: string; claimedBy?: string; claimedAt?: string };
type Assignment = { userId: string; projectId: string; active: boolean; assignedBy: string; createdAt: string };
type ReviewEvent = { reviewerUserId: string; reviewerEmail: string; decision: string; reason: string; at: string };
type Submission = {
  id: string; projectId: string; projectTitle: string; enumerator: string;
  submittedByUserId?: string; submittedByEmail?: string;
  answers: Record<string, string>; latitude?: number; longitude?: number;
  audioStatus: string; audioPath?: string; reviewStatus: string; submittedAt: string;
  reviewReason?: string; reviewedBy?: string; reviewedAt?: string; reviewHistory?: ReviewEvent[];
};
const PROJECTS = 'cmrg_projects';
const SUBMISSIONS = 'cmrg_submissions';
const STAFF = 'cmrg_staff';
const INVITES = 'cmrg_staff_invites';
const ASSIGNMENTS = 'cmrg_assignments';
const AUDIT = 'cmrg_audit';
const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const safe = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const makeId = (prefix: string) => prefix + '_' + crypto.randomUUID().replace(/-/g, '');
const emailOf = (value: unknown) => safe(value).toLowerCase();
const roles: StaffRole[] = ['Administrator', 'Research Manager', 'Supervisor', 'Situation Room Officer', 'Interviewer'];
const adminEmails = (env.CMRG_ADMIN_EMAILS || '').split(',').map(emailOf).filter(Boolean);
const allowedDomains = (env.CMRG_ALLOWED_EMAIL_DOMAINS || 'cmrgltd.com').split(',').map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
const isOrgEmail = (email: string) => allowedDomains.some(domain => email.endsWith('@' + domain));
const isAdmin = (staff: Staff) => staff.active && staff.role === 'Administrator';
const canReview = (staff: Staff) => staff.active && ['Administrator', 'Research Manager', 'Supervisor', 'Situation Room Officer'].includes(staff.role);
const canManageProjects = (staff: Staff) => staff.active && ['Administrator', 'Research Manager'].includes(staff.role);

async function staffFor(userId: string) {
  const [staff] = await db.get<Staff>(STAFF, [userId], { consistent: true });
  return staff;
}
async function ensureProjectAccess(staff: Staff, projectId: string) {
  if (isAdmin(staff)) return true;
  const assigned = await db.list<Assignment>(ASSIGNMENTS, { limit: 500 });
  return assigned.items.some(a => a.active && a.userId === staff.userId && a.projectId === projectId);
}
async function projectFor(projectId: string) {
  const [project] = await db.get<Project>(PROJECTS, [projectId], { consistent: true });
  return project;
}
const staffRequired = async (ctx: { user?: { userId: string } }) => {
  if (!ctx.user) return error('Sign in is required.', 401);
  const staff = await staffFor(ctx.user.userId);
  if (!staff || !staff.active) return error('Your CMRG account is not authorised or has been deactivated. Contact the CMRG administrator.', 403);
  return undefined;
};

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ ok: true, service: 'CMRG Data Collect' })],

  'GET /api/auth/me': [
    requireAuth(), withScopes('email'),
    async ctx => {
      const email = emailOf(ctx.user?.email);
      if (!email || !isOrgEmail(email)) return error('Use your CMRG organisational email address to sign in.', 403);
      let staff = await staffFor(ctx.user!.userId);
      if (!staff) {
        if (adminEmails.includes(email)) {
          const seed: Staff = { userId: ctx.user!.userId, email, name: ctx.user!.name, role: 'Administrator', active: true, createdAt: new Date().toISOString() };
          const [created] = await db.tx.add(STAFF, [{ id: seed.userId, ...seed }]);
          staff = created ? seed : await staffFor(seed.userId);
        } else {
          const inviteRows = await db.list<StaffInvite>(INVITES, { limit: 500 });
          const inviteRow = inviteRows.items.find(i => i.active && emailOf(i.email) === email);
          if (inviteRow) {
            const seed: Staff = { userId: ctx.user!.userId, email, name: ctx.user!.name, role: inviteRow.role, active: true, createdAt: new Date().toISOString() };
            const [created] = await db.tx.add(STAFF, [{ id: seed.userId, ...seed }]);
            staff = created ? seed : await staffFor(seed.userId);
            if (staff) {
              for (const projectId of inviteRow.projectIds || []) {
                const has = await ensureProjectAccess(staff, projectId);
                if (!has) await db.add(ASSIGNMENTS, [{ userId: staff.userId, projectId, active: true, assignedBy: inviteRow.invitedBy, createdAt: new Date().toISOString() }]);
              }
              await db.update(INVITES, [{ id: inviteRow.id, record: { ...inviteRow, active: false, claimedBy: staff.userId, claimedAt: new Date().toISOString() } }]);
            }
          }
        }
      }
      if (!staff || !staff.active) return error('Your account has not been invited to CMRG Data Collect. Ask an administrator to authorize your organisational email.', 403);
      return json({ staff, auth: { authenticated: true, provider: 'AppDeploy passwordless email sign-in' } });
    },
  ],

  'GET /api/projects': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const staff = await staffFor(ctx.user!.userId);
      if (!staff) return error('Staff account not found.', 403);
      const r = await db.list<Project>(PROJECTS, { limit: 100 });
      if (isAdmin(staff)) return json({ projects: r.items });
      const assignments = await db.list<Assignment>(ASSIGNMENTS, { limit: 500 });
      const ids = new Set(assignments.items.filter(a => a.active && a.userId === staff.userId).map(a => a.projectId));
      return json({ projects: r.items.filter(p => ids.has(p.id)) });
    },
  ],

  'POST /api/projects': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const staff = await staffFor(ctx.user!.userId);
      if (!staff || !canManageProjects(staff)) return error('Your role cannot create projects.', 403);
      const b = ctx.body as Partial<Project>;
      const title = safe(b.title);
      if (!title || !Array.isArray(b.questions) || !b.questions.length) return error('Project title and at least one question are required.', 400);
      if (title.length > 180 || b.questions.length > 250) return error('Project title or question count exceeds the allowed limit.', 400);
      const project: Project = {
        id: makeId('prj'), title, description: safe(b.description).slice(0, 1000),
        accessCode: safe(b.accessCode).toUpperCase().slice(0, 12),
        questions: b.questions.map((q, i) => ({
          id: safe(q.id) || 'q' + i, label: safe(q.label).slice(0, 500),
          type: ['text', 'textarea', 'number', 'select', 'yesno'].includes(q.type) ? q.type : 'text',
          required: !!q.required, options: Array.isArray(q.options) ? q.options.slice(0, 50).map(x => String(x).slice(0, 200)) : undefined,
        })),
        createdAt: new Date().toISOString(),
      };
      const [id] = await db.add(PROJECTS, [project]);
      if (!id) return error('Project could not be saved.', 500);
      project.id = id;
      if (!isAdmin(staff)) await db.add(ASSIGNMENTS, [{ userId: staff.userId, projectId: id, active: true, assignedBy: staff.userId, createdAt: new Date().toISOString() }]);
      return json({ project });
    },
  ],

  'GET /api/submissions': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const staff = await staffFor(ctx.user!.userId);
      if (!staff) return error('Staff account not found.', 403);
      const r = await db.list<Submission>(SUBMISSIONS, { limit: 200 });
      const assignments = await db.list<Assignment>(ASSIGNMENTS, { limit: 500 });
      const projectIds = new Set(assignments.items.filter(a => a.active && a.userId === staff.userId).map(a => a.projectId));
      const authorised = r.items.filter(s => {
        if (isAdmin(staff)) return true;
        if (staff.role === 'Interviewer') return s.submittedByUserId === staff.userId;
        return projectIds.has(s.projectId);
      });
      const submissions = await Promise.all(authorised.map(async s => {
        let audioUrl: string | undefined;
        if (s.audioPath) {
          try { audioUrl = (await storage.url([s.audioPath]))[0]?.url; } catch { audioUrl = undefined; }
        }
        const { audioPath, ...safeSubmission } = s;
        return { ...safeSubmission, audioUrl };
      }));
      return json({ submissions });
    },
  ],

  'POST /api/submissions': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const staff = await staffFor(ctx.user!.userId);
      if (!staff) return error('Staff account not authorised.', 403);
      const b = ctx.body as { projectId?: string; accessCode?: string; enumerator?: string; answers?: Record<string, string>; latitude?: number; longitude?: number; audioBase64?: string; contentType?: string; audioStatus?: string };
      if (!safe(b.projectId) || !safe(b.enumerator)) return error('Project and interviewer ID are required.', 400);
      if (!await ensureProjectAccess(staff, safe(b.projectId))) return error('You are not assigned to this project.', 403);
      const project = await projectFor(safe(b.projectId));
      if (!project) return error('Questionnaire not found.', 404);
      if (safe(b.accessCode) && project.accessCode.toUpperCase() !== safe(b.accessCode).toUpperCase()) return error('Invalid project access code.', 403);
      const answers = b.answers && typeof b.answers === 'object' ? Object.fromEntries(Object.entries(b.answers).slice(0, 250).map(([k, v]) => [String(k).slice(0, 100), String(v).slice(0, 5000)])) : {};
      for (const q of project.questions) if (q.required && !safe(answers[q.id])) return error('Please answer required question: ' + q.label, 400);
      if ((b.latitude !== undefined && !Number.isFinite(b.latitude)) || (b.longitude !== undefined && !Number.isFinite(b.longitude))) return error('Invalid GPS coordinates.', 400);
      if ((b.latitude === undefined) !== (b.longitude === undefined)) return error('Latitude and longitude must be supplied together.', 400);
      const id = makeId('rsp');
      let audioPath: string | undefined;
      let audioStatus = safe(b.audioStatus) === 'Awaiting audio upload' ? 'Awaiting audio upload' : 'Not recorded';
      if (b.audioBase64) {
        if (b.audioBase64.length > 5_000_000) return error('Audio file is too large for this basic release (maximum about 3.5 MB).', 413);
        if (!/^[A-Za-z0-9+/=]+$/.test(b.audioBase64)) return error('Invalid audio data.', 400);
        audioPath = 'audio/' + id + '.webm';
        const [ok] = await storage.write([{ path: audioPath, content: b.audioBase64, contentType: safe(b.contentType) || 'audio/webm' }]);
        if (ok) audioStatus = 'Uploaded'; else { audioPath = undefined; audioStatus = 'Upload failed'; }
      }
      const submission: Submission = {
        id, projectId: project.id, projectTitle: project.title,
        enumerator: safe(b.enumerator).slice(0, 120),
        submittedByUserId: staff.userId, submittedByEmail: staff.email,
        answers, latitude: b.latitude, longitude: b.longitude, audioStatus, audioPath,
        reviewStatus: 'Pending', submittedAt: new Date().toISOString(), reviewHistory: [],
      };
      const [savedId] = await db.add(SUBMISSIONS, [submission]);
      if (!savedId) { if (audioPath) await storage.delete([audioPath]); return error('Response could not be saved. Please retry when connected.', 500); }
      return json({ ok: true, id: savedId, audioStatus, message: audioStatus === 'Uploaded' ? 'Response saved and audio uploaded successfully.' : 'Response saved. Audio status: ' + audioStatus + '.' });
    },
  ],

  'POST /api/submissions/:id/audio': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const staff = await staffFor(ctx.user!.userId);
      if (!staff) return error('Staff account not found.', 403);
      const b = ctx.body as { audioBase64?: string; contentType?: string; fileName?: string };
      if (!b.audioBase64 || !/^[A-Za-z0-9+/=]+$/.test(b.audioBase64)) return error('Choose a valid audio file to upload.', 400);
      if (b.audioBase64.length > 5_000_000) return error('Audio file is too large for this basic release (maximum about 3.5 MB).', 413);
      const [submission] = await db.get<Submission>(SUBMISSIONS, [ctx.params.id], { consistent: true });
      if (!submission) return error('Field record not found.', 404);
      if (!await ensureProjectAccess(staff, submission.projectId)) return error('You are not assigned to this project.', 403);
      if (staff.role === 'Interviewer' && submission.submittedByUserId !== staff.userId) return error('You can upload media only for your own submissions.', 403);
      const audioPath = 'audio/' + ctx.params.id + '.upload';
      const [stored] = await storage.write([{ path: audioPath, content: b.audioBase64, contentType: safe(b.contentType) || 'audio/webm' }]);
      if (!stored) return error('Audio storage did not confirm the upload. Retry the upload.', 500);
      const updated = { ...submission, audioPath, audioStatus: 'Uploaded' };
      const [saved] = await db.update(SUBMISSIONS, [{ id: ctx.params.id, record: updated }]);
      if (!saved) { await storage.delete([audioPath]); return error('Audio was stored but its status could not be saved. Please retry.', 500); }
      return json({ ok: true, audioStatus: 'Uploaded', message: 'Audio stored successfully.' });
    },
  ],

  'PUT /api/submissions/:id': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const staff = await staffFor(ctx.user!.userId);
      if (!staff || !canReview(staff)) return error('Your role cannot review submissions.', 403);
      const b = ctx.body as { reviewStatus?: string; reason?: string };
      const status = safe(b.reviewStatus);
      if (!['Pending', 'Verified', 'Flagged', 'Rejected'].includes(status)) return error('Review status must be Pending, Verified, Flagged, or Rejected.', 400);
      const [s] = await db.get<Submission>(SUBMISSIONS, [ctx.params.id], { consistent: true });
      if (!s) return error('Submission not found.', 404);
      if (!await ensureProjectAccess(staff, s.projectId)) return error('You are not assigned to this project.', 403);
      const at = new Date().toISOString();
      const reason = safe(b.reason).slice(0, 2000);
      if (['Flagged', 'Rejected'].includes(status) && !reason) return error('A reason is required when flagging or rejecting a submission.', 400);
      const event: ReviewEvent = { reviewerUserId: staff.userId, reviewerEmail: staff.email, decision: status, reason, at };
      const audit = { id: makeId('aud'), eventType: 'submission_review', submissionId: s.id, projectId: s.projectId, actorUserId: staff.userId, actorEmail: staff.email, decision: status, reason, at };
      const [auditId] = await db.add(AUDIT, [audit]);
      if (!auditId) return error('The review audit record could not be saved; no decision was applied.', 500);
      const updated = { ...s, reviewStatus: status, reviewReason: reason, reviewedBy: staff.email, reviewedAt: at, reviewHistory: [...(s.reviewHistory || []), event] };
      const [saved] = await db.update(SUBMISSIONS, [{ id: s.id, record: updated }]);
      if (!saved) return error('Audit recorded, but submission status could not be updated. Contact an administrator before retrying.', 500);
      return json({ ok: true, reviewStatus: status, reviewedBy: staff.email, reviewedAt: at });
    },
  ],

  'GET /api/admin/staff': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const staff = await staffFor(ctx.user!.userId);
      if (!staff || !isAdmin(staff)) return error('Administrator permission required.', 403);
      const [users, invites, assignments] = await Promise.all([
        db.list<Staff>(STAFF, { limit: 500 }),
        db.list<StaffInvite>(INVITES, { limit: 500 }),
        db.list<Assignment>(ASSIGNMENTS, { limit: 500 }),
      ]);
      return json({ staff: users.items, invitations: invites.items, assignments: assignments.items });
    },
  ],

  'POST /api/admin/staff': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const actor = await staffFor(ctx.user!.userId);
      if (!actor || !isAdmin(actor)) return error('Administrator permission required.', 403);
      const b = ctx.body as { email?: string; role?: StaffRole; projectIds?: string[] };
      const email = emailOf(b.email);
      const role = b.role;
      const projectIds = Array.isArray(b.projectIds) ? [...new Set(b.projectIds.map(safe).filter(Boolean))].slice(0, 100) : [];
      if (!email || !isOrgEmail(email)) return error('Use a CMRG organisational email address.', 400);
      if (!role || !roles.includes(role) || role === 'Administrator') return error('Choose a valid non-administrator role. Administrator access must be provisioned separately.', 400);
      const users = await db.list<Staff>(STAFF, { limit: 500 });
      if (users.items.some(u => emailOf(u.email) === email)) return error('This email already has an account. Use the staff assignment controls.', 409);
      const invites = await db.list<StaffInvite>(INVITES, { limit: 500 });
      if (invites.items.some(i => emailOf(i.email) === email && i.active)) return error('An active invitation already exists for this email.', 409);
      for (const projectId of projectIds) if (!await projectFor(projectId)) return error('Unknown project ID: ' + projectId, 400);
      const invite: StaffInvite = { email, role, projectIds, active: true, invitedBy: actor.userId, invitedAt: new Date().toISOString() };
      const [id] = await db.add(INVITES, [invite]);
      if (!id) return error('Staff invitation could not be saved.', 500);
      return json({ ok: true, invitation: { id, ...invite }, message: 'Staff email authorized. Share the existing app URL with this person; no email has been sent by this app.' });
    },
  ],

  'PUT /api/admin/staff/:id': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const actor = await staffFor(ctx.user!.userId);
      if (!actor || !isAdmin(actor)) return error('Administrator permission required.', 403);
      const b = ctx.body as { active?: boolean; role?: StaffRole };
      const [target] = await db.get<Staff>(STAFF, [ctx.params.id], { consistent: true });
      if (!target) return error('Staff account not found.', 404);
      if (target.userId === actor.userId && b.active === false) return error('You cannot deactivate your own administrator account.', 400);
      const role = b.role && roles.includes(b.role) ? b.role : target.role;
      const updated = { ...target, active: typeof b.active === 'boolean' ? b.active : target.active, role };
      const [saved] = await db.update(STAFF, [{ id: target.userId, record: updated }]);
      if (!saved) return error('Staff account could not be updated.', 500);
      return json({ ok: true, staff: updated });
    },
  ],

  'PUT /api/admin/staff/:id/assignments': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const actor = await staffFor(ctx.user!.userId);
      if (!actor || !isAdmin(actor)) return error('Administrator permission required.', 403);
      const [target] = await db.get<Staff>(STAFF, [ctx.params.id], { consistent: true });
      if (!target) return error('Staff account not found.', 404);
      const b = ctx.body as { projectIds?: string[] };
      const projectIds = Array.isArray(b.projectIds) ? [...new Set(b.projectIds.map(safe).filter(Boolean))].slice(0, 100) : [];
      for (const projectId of projectIds) if (!await projectFor(projectId)) return error('Unknown project ID: ' + projectId, 400);
      const rows = await db.list<Assignment>(ASSIGNMENTS, { limit: 500 });
      for (const row of rows.items.filter(a => a.userId === target.userId)) {
        const active = projectIds.includes(row.projectId);
        if (row.active !== active) await db.update(ASSIGNMENTS, [{ id: row.id, record: { ...row, active } }]);
      }
      for (const projectId of projectIds) {
        if (!rows.items.some(a => a.userId === target.userId && a.projectId === projectId)) {
          const [saved] = await db.add(ASSIGNMENTS, [{ userId: target.userId, projectId, active: true, assignedBy: actor.userId, createdAt: new Date().toISOString() }]);
          if (!saved) return error('One or more project assignments could not be saved.', 500);
        }
      }
      return json({ ok: true, projectIds });
    },
  ],

  'PUT /api/admin/invites/:id': [
    requireAuth(), withScopes('email'), staffRequired,
    async ctx => {
      const actor = await staffFor(ctx.user!.userId);
      if (!actor || !isAdmin(actor)) return error('Administrator permission required.', 403);
      const [invite] = await db.get<StaffInvite>(INVITES, [ctx.params.id], { consistent: true });
      if (!invite) return error('Invitation not found.', 404);
      const b = ctx.body as { active?: boolean };
      const updated = { ...invite, active: typeof b.active === 'boolean' ? b.active : invite.active };
      const [saved] = await db.update(INVITES, [{ id: ctx.params.id, record: updated }]);
      if (!saved) return error('Invitation could not be updated.', 500);
      return json({ ok: true, invitation: updated });
    },
  ],
});