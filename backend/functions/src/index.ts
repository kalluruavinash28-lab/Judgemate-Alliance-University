import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { randomBytes } from 'node:crypto';

initializeApp();
const db = getFirestore();
const auth = getAuth();
type Actor = { uid: string; role: string; eventId?: string };
function actorOf(request: { auth?: { uid: string; token: Record<string, unknown> } }): Actor {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return { uid: request.auth.uid, role: String(request.auth.token.role || ''), eventId: String(request.auth.token.eventId || '') };
}
function requireAdmin(actor: Actor) { if (actor.role !== 'admin') throw new HttpsError('permission-denied', 'Administrator access required.'); }
function eventPath(id: string) { if (!id || id.length > 100) throw new HttpsError('invalid-argument', 'Invalid event ID.'); return db.collection('events').doc(id); }
function randomPassword() { return `${randomBytes(9).toString('base64url')}!7`; }

export const createJudge = onCall(async request => {
  const actor = actorOf(request); requireAdmin(actor);
  const { eventId, displayName } = request.data as { eventId?: string; displayName?: string };
  if (!displayName?.trim() || displayName.length > 100) throw new HttpsError('invalid-argument', 'Judge name is required.');
  const event = eventPath(eventId || ''); const snapshot = await event.get();
  if (!snapshot.exists || snapshot.get('status') === 'CLOSED') throw new HttpsError('failed-precondition', 'Event is missing or closed.');
  const slug = displayName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'judge';
  const username = `${slug}_${event.id.slice(0, 8)}`;
  const password = randomPassword();
  const user = await auth.createUser({ email: `${username}@judgemate.invalid`, password, displayName: displayName.trim(), disabled: false });
  await auth.setCustomUserClaims(user.uid, { role: 'judge', eventId: event.id, mustChangePassword: true });
  await event.collection('judges').doc(user.uid).set({ uid: user.uid, username, displayName: displayName.trim(), active: true, mustChangePassword: true, createdAt: FieldValue.serverTimestamp() });
  return { uid: user.uid, username, temporaryPassword: password };
});

export const setEventStatus = onCall(async request => {
  const actor = actorOf(request); requireAdmin(actor);
  const { eventId, status } = request.data as { eventId?: string; status?: string };
  if (!['DRAFT', 'ACTIVE', 'CLOSED'].includes(status || '')) throw new HttpsError('invalid-argument', 'Invalid status.');
  const event = eventPath(eventId || '');
  await db.runTransaction(async tx => {
    const snap = await tx.get(event); if (!snap.exists) throw new HttpsError('not-found', 'Event not found.');
    if (snap.get('status') === 'CLOSED' && status !== 'CLOSED') throw new HttpsError('failed-precondition', 'Closed events cannot be reopened.');
    let judges: FirebaseFirestore.QuerySnapshot | undefined;
    if (status === 'CLOSED') {
      judges = await tx.get(event.collection('judges'));
    }
    tx.update(event, { status, updatedAt: FieldValue.serverTimestamp() });
    for (const judge of judges?.docs || []) tx.update(judge.ref, { active: false, closedAt: FieldValue.serverTimestamp() });
  });
  if (status === 'CLOSED') {
    const judges = await event.collection('judges').get();
    await Promise.all(judges.docs.map(j => auth.updateUser(j.id, { disabled: true }).catch(() => undefined)));
  }
  return { status };
});

export const assignTeams = onCall(async request => {
  const actor = actorOf(request); requireAdmin(actor);
  const { eventId, judgesPerTeam = 1 } = request.data as { eventId?: string; judgesPerTeam?: number };
  if (!Number.isInteger(judgesPerTeam) || judgesPerTeam < 1 || judgesPerTeam > 10) throw new HttpsError('invalid-argument', 'Judges per team must be from 1 to 10.');
  const event = eventPath(eventId || '');
  if ((await event.get()).get('status') !== 'DRAFT') throw new HttpsError('failed-precondition', 'Assignments can only be changed before evaluation starts.');
  const [teams, judges] = await Promise.all([event.collection('teams').get(), event.collection('judges').where('active', '==', true).get()]);
  if (!judges.size) throw new HttpsError('failed-precondition', 'Add active judges before assigning teams.');
  const refs = teams.docs.map(t => t.ref); const judgeIds = judges.docs.map(j => j.id);
  const assignments = new Map<string, string[]>();
  refs.forEach((team, i) => assignments.set(team.id, Array.from({ length: Math.min(judgesPerTeam, judgeIds.length) }, (_, k) => judgeIds[(i + k) % judgeIds.length])));
  const batch = db.batch();
  for (const [teamId, judgeUids] of assignments) batch.set(event.collection('assignments').doc(teamId), { teamId, judgeUids, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { teams: refs.length, judges: judgeIds.length };
});

export const saveEvaluation = onCall(async request => {
  const actor = actorOf(request);
  if (actor.role !== 'judge' || !actor.eventId) throw new HttpsError('permission-denied', 'Judge access required.');
  const { teamId, scores, feedback } = request.data as { teamId?: string; scores?: Record<string, number>; feedback?: string };
  if (!teamId || !scores || typeof scores !== 'object' || typeof feedback !== 'string' || feedback.length > 5000) throw new HttpsError('invalid-argument', 'Evaluation data is incomplete.');
  const event = eventPath(actor.eventId); const judgeRef = event.collection('judges').doc(actor.uid); const assignmentRef = event.collection('assignments').doc(teamId); const evaluationRef = event.collection('evaluations').doc(`${teamId}_${actor.uid}`);
  await db.runTransaction(async tx => {
    const [eventSnap, judgeSnap, assignmentSnap, previous] = await Promise.all([tx.get(event), tx.get(judgeRef), tx.get(assignmentRef), tx.get(evaluationRef)]);
    if (eventSnap.get('status') !== 'ACTIVE') throw new HttpsError('failed-precondition', 'Event evaluation is not active.');
    if (!judgeSnap.exists || !judgeSnap.get('active') || !assignmentSnap.exists || !(assignmentSnap.get('judgeUids') as string[]).includes(actor.uid)) throw new HttpsError('permission-denied', 'This team is not assigned to this judge.');
    const criteria = eventSnap.get('criteria') as Array<{ id: string; max: number }> | undefined;
    if (!criteria?.length || Object.keys(scores).length !== criteria.length) throw new HttpsError('invalid-argument', 'Scores must match all event criteria.');
    let total = 0;
    for (const criterion of criteria) { const score = scores[criterion.id]; if (!Number.isFinite(score) || score < 0 || score > criterion.max) throw new HttpsError('invalid-argument', `Invalid score for ${criterion.id}.`); total += score; }
    const version = Number(previous.get('version') || 0) + 1;
    const record = { teamId, judgeUid: actor.uid, scores, total, feedback, version, updatedAt: FieldValue.serverTimestamp() };
    tx.set(event.collection('evaluationHistory').doc(`${teamId}_${actor.uid}_v${version}`), { ...record, changeType: previous.exists ? 'revision' : 'submission' });
    tx.set(evaluationRef, record);
  });
  return { saved: true };
});
