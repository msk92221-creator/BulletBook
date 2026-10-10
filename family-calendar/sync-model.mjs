// Only calendar entries cross this boundary. Journal pages and credentials never do.
export const localFingerprint = entry => JSON.stringify([entry.date, entry.title]);
export const remoteFingerprint = event => event ? JSON.stringify([
  event.title, event.startDate, event.endDate, event.startTime, event.endTime,
  event.allDay, event.repeat, event.repeatUntil, event.notes, event.isPrivate,
]) : null;

export async function linkedEventId(bookId, sourceId) {
  const bytes = new TextEncoder().encode(JSON.stringify([bookId, sourceId]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'bb-' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function importedEvent(entry, id, uid) {
  return { id, title: entry.title.slice(0, 100), location: '',
    notes: entry.title.length > 100 ? entry.title : '',
    startDate: entry.date, endDate: entry.date, startTime: '09:00', endTime: '10:00',
    allDay: true, repeat: 'none', repeatUntil: '', category: 'family',
    participants: [uid], isPrivate: false, createdBy: uid };
}

export function reconcileEntry(entry, binding, remote, id, uid) {
  const local = localFingerprint(entry);
  const cloud = remoteFingerprint(remote);
  if (!binding) return { write: remote ? null : importedEvent(entry, id, uid),
    binding: { id, local, cloud, date: entry.date, kind: entry.kind } };
  // A remote deletion is intentional. Opening another device must not resurrect it.
  if (!remote) return { write: null, binding: { ...binding, local, cloud: null, deleted: true } };
  if (binding.deleted || local === binding.local) return {
    write: null, binding: { ...binding, local, cloud, deleted: false },
  };
  // Preserve concurrent family edits; the original notebook still holds the local text.
  if (cloud !== binding.cloud) return {
    write: null, conflict: true, binding: { ...binding, local, cloud, deleted: false },
  };
  const shift = Date.parse(entry.date + 'T12:00:00Z') - Date.parse(remote.startDate + 'T12:00:00Z');
  const end = new Date(Date.parse(remote.endDate + 'T12:00:00Z') + shift).toISOString().slice(0, 10);
  const write = { ...remote, title: entry.title.slice(0, 100), startDate: entry.date, endDate: end };
  if (entry.title.length > 100) write.notes = entry.title + (remote.notes ? '\n\n' + remote.notes : '');
  write.notes = write.notes.slice(0, 3000);
  return { write, binding: { ...binding, local, cloud: remoteFingerprint(write), date: entry.date, deleted: false } };
}
